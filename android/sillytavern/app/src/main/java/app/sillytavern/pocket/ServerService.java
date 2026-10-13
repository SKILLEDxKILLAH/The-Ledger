package app.sillytavern.pocket;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.ServiceInfo;
import android.content.res.AssetFileDescriptor;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.system.Os;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileWriter;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.Writer;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Unpacks SillyTavern from the APK and runs its Node.js server as a child process,
 * kept alive by a foreground service so replies keep streaming while the app is in
 * the background.
 *
 * Layout under filesDir:
 *   app/          SillyTavern code, replaced whenever the APK changes
 *   data/         user data (characters, chats, settings); never touched by updates
 *   config.yaml   server config, created by SillyTavern on first run
 *   runtime-lib/  SONAME symlinks into nativeLibraryDir for the Node runtime
 *   logs/server.log
 */
public class ServerService extends Service {
    private static final String TAG = "STPocket";
    public static final int PORT = 8000;
    public static final String ORIGIN = "http://127.0.0.1:" + PORT + "/";
    static final String ACTION_STOP = "app.sillytavern.pocket.STOP";
    private static final String CHANNEL = "server";
    private static final int NOTIF_ID = 1;
    private static final int LOG_TAIL = 80;

    public enum State { IDLE, UNPACKING, STARTING, RUNNING, FAILED }

    public interface Listener {
        void onState(State state, String detail, int progress);
    }

    private static final CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static volatile State state = State.IDLE;
    private static volatile String detail = "";
    private static volatile int progress = -1;
    private static final ArrayDeque<String> logTail = new ArrayDeque<>();

    private Thread worker;
    private volatile Process process;
    private volatile boolean stopping;

    public static void addListener(Listener l) {
        listeners.add(l);
        l.onState(state, detail, progress);
    }

    public static void removeListener(Listener l) {
        listeners.remove(l);
    }

    public static State state() {
        return state;
    }

    static String logTail() {
        synchronized (logTail) {
            return String.join("\n", logTail);
        }
    }

    private void set(State s, String d, int p) {
        state = s;
        detail = d;
        progress = p;
        main.post(() -> {
            for (Listener l : listeners) l.onState(s, d, p);
            updateNotification();
        });
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationChannel ch = new NotificationChannel(CHANNEL, getString(R.string.channel_name),
                NotificationManager.IMPORTANCE_LOW);
        ch.setShowBadge(false);
        getSystemService(NotificationManager.class).createNotificationChannel(ch);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopServer();
            set(State.IDLE, "", -1);
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        startForeground(NOTIF_ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        if (worker == null || !worker.isAlive()) {
            stopping = false;
            worker = new Thread(this::run, "st-server");
            worker.start();
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Swiping the app away from Recents quits it, server included.
        stopServer();
        set(State.IDLE, "", -1);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        stopServer();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ---- server lifecycle ----------------------------------------------------------

    private void run() {
        try {
            File appDir = ensureUnpacked();
            File libDir = linkRuntimeLibs();
            if (stopping) return;
            launch(appDir, libDir);
        } catch (Exception e) {
            Log.e(TAG, "server failed", e);
            appendLog("[app] " + e);
            if (!stopping) set(State.FAILED, e.getMessage() == null ? e.toString() : e.getMessage(), -1);
        }
    }

    private void stopServer() {
        stopping = true;
        Process p = process;
        if (p == null) return;
        p.destroy();
        try {
            if (!p.waitFor(3, java.util.concurrent.TimeUnit.SECONDS)) p.destroyForcibly();
        } catch (InterruptedException ignored) {
            p.destroyForcibly();
        }
        process = null;
    }

    /** Extracts assets/sillytavern.zip into filesDir/app when the installed APK changes. */
    private File ensureUnpacked() throws Exception {
        File appDir = new File(getFilesDir(), "app");
        File stamp = new File(getFilesDir(), "app.stamp");
        PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
        String want = pi.getLongVersionCode() + ":" + pi.lastUpdateTime;
        if (appDir.isDirectory() && stamp.exists()
                && want.equals(new String(Files.readAllBytes(stamp.toPath()), StandardCharsets.UTF_8))) {
            return appDir;
        }

        set(State.UNPACKING, getString(R.string.unpacking), 0);
        deleteTree(appDir);
        File tmp = new File(getFilesDir(), "app.tmp");
        deleteTree(tmp);
        tmp.mkdirs();

        long total = -1;
        try (AssetFileDescriptor fd = getAssets().openFd("sillytavern.zip")) {
            total = fd.getLength();
        } catch (IOException ignored) {
            // Compressed asset; progress stays indeterminate.
        }
        String root = tmp.getCanonicalPath() + File.separator;
        byte[] buf = new byte[1 << 16];
        try (CountingStream raw = new CountingStream(getAssets().open("sillytavern.zip"));
             ZipInputStream zip = new ZipInputStream(new java.io.BufferedInputStream(raw, 1 << 16))) {
            ZipEntry e;
            int lastPct = -1;
            while ((e = zip.getNextEntry()) != null) {
                File out = new File(tmp, e.getName());
                if (!out.getCanonicalPath().startsWith(root)) throw new IOException("bad zip entry " + e.getName());
                if (e.isDirectory()) {
                    out.mkdirs();
                    continue;
                }
                out.getParentFile().mkdirs();
                try (OutputStream os = new FileOutputStream(out)) {
                    int n;
                    while ((n = zip.read(buf)) > 0) os.write(buf, 0, n);
                }
                if (total > 0) {
                    int pct = (int) (raw.count * 100 / total);
                    if (pct != lastPct) {
                        lastPct = pct;
                        set(State.UNPACKING, getString(R.string.unpacking), pct);
                    }
                }
            }
        }
        if (!tmp.renameTo(appDir)) throw new IOException("could not move unpacked app into place");
        try (Writer w = new FileWriter(stamp)) {
            w.write(want);
        }
        return appDir;
    }

    /**
     * The runtime's libraries are packaged as libst_*.so (Android only extracts lib*.so).
     * Recreate SONAME symlinks pointing at them; nativeLibraryDir moves on every update.
     */
    private File linkRuntimeLibs() throws Exception {
        File dir = new File(getFilesDir(), "runtime-lib");
        deleteTree(dir);
        dir.mkdirs();
        String nativeDir = getApplicationInfo().nativeLibraryDir;
        try (BufferedReader r = new BufferedReader(new InputStreamReader(
                getAssets().open("runtime-libs.txt"), StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) {
                String[] parts = line.trim().split("\t");
                if (parts.length != 2) continue;
                Os.symlink(nativeDir + "/" + parts[1], new File(dir, parts[0]).getPath());
            }
        }
        return dir;
    }

    private void launch(File appDir, File libDir) throws Exception {
        set(State.STARTING, getString(R.string.starting), -1);
        File files = getFilesDir();
        File home = new File(files, "home");
        File data = new File(files, "data");
        File logs = new File(files, "logs");
        home.mkdirs();
        data.mkdirs();
        logs.mkdirs();

        String node = getApplicationInfo().nativeLibraryDir + "/libst_node.so";
        List<String> cmd = new ArrayList<>(List.of(
                node,
                // Pixel 9 Pro has 16 GB of RAM; give V8 room for large chats and vector work.
                "--max-old-space-size=4096",
                "server.js",
                "--configPath", new File(files, "config.yaml").getPath(),
                "--dataRoot", data.getPath(),
                "--port", String.valueOf(PORT),
                "--listen", "false",
                "--browserLaunchEnabled", "false"));
        ProcessBuilder pb = new ProcessBuilder(cmd).directory(appDir).redirectErrorStream(true);
        Map<String, String> env = pb.environment();
        env.put("LD_LIBRARY_PATH", libDir.getPath());
        env.put("HOME", home.getPath());
        env.put("TMPDIR", getCacheDir().getPath());
        env.put("NODE_ENV", "production");
        env.put("FORCE_COLOR", "0");
        // Android has no `git` binary: use SillyTavern's built-in git client, and skip
        // the startup auto-update, which always shells out to system git. The Plugin
        // Ledger updates plugins by reinstalling them through the built-in client.
        env.put("SILLYTAVERN_GIT_BACKEND", "builtin");
        env.put("SILLYTAVERN_EXTENSIONS_AUTOUPDATE", "false");

        synchronized (logTail) {
            logTail.clear();
        }
        Process p = pb.start();
        process = p;

        Thread pump = new Thread(() -> pumpLog(p.getInputStream(), new File(logs, "server.log")), "st-log");
        pump.start();
        Thread probe = new Thread(() -> waitUntilReady(p), "st-probe");
        probe.start();

        int code = p.waitFor();
        pump.join(2000);
        process = null;
        if (!stopping) {
            set(State.FAILED, getString(R.string.failed) + " (exit " + code + ")", -1);
        }
    }

    private void waitUntilReady(Process p) {
        while (p.isAlive() && !stopping) {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(ORIGIN).openConnection();
                c.setConnectTimeout(1000);
                c.setReadTimeout(5000);
                int code = c.getResponseCode();
                c.disconnect();
                if (code > 0) {
                    set(State.RUNNING, "", -1);
                    return;
                }
            } catch (IOException ignored) {
                // Not listening yet.
            }
            try {
                Thread.sleep(400);
            } catch (InterruptedException e) {
                return;
            }
        }
    }

    private void pumpLog(InputStream in, File file) {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
             Writer w = new FileWriter(file, false)) {
            String line;
            while ((line = r.readLine()) != null) {
                w.write(line);
                w.write('\n');
                w.flush();
                appendLog(line);
                if (state == State.STARTING && !line.isBlank()) {
                    set(State.STARTING, getString(R.string.starting) + "\n\n" + line.trim(), -1);
                }
            }
        } catch (IOException e) {
            Log.w(TAG, "log pump ended", e);
        }
    }

    private static void appendLog(String line) {
        synchronized (logTail) {
            logTail.addLast(line);
            while (logTail.size() > LOG_TAIL) logTail.removeFirst();
        }
    }

    // ---- notification -------------------------------------------------------------

    private Notification buildNotification() {
        PendingIntent open = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 1,
                new Intent(this, ServerService.class).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE);
        String text = getString(state == State.RUNNING ? R.string.notif_running : R.string.notif_starting);
        return new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(text)
                .setContentIntent(open)
                .setOngoing(true)
                .setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
                .addAction(new Notification.Action.Builder(null, getString(R.string.notif_stop), stop).build())
                .build();
    }

    private void updateNotification() {
        if (state == State.IDLE) return;
        getSystemService(NotificationManager.class).notify(NOTIF_ID, buildNotification());
    }

    // ---- helpers ------------------------------------------------------------------

    private static void deleteTree(File f) {
        if (!f.exists() && !isSymlink(f)) return;
        if (f.isDirectory() && !isSymlink(f)) {
            File[] kids = f.listFiles();
            if (kids != null) for (File k : kids) deleteTree(k);
        }
        f.delete();
    }

    private static boolean isSymlink(File f) {
        return Files.isSymbolicLink(f.toPath());
    }

    private static final class CountingStream extends java.io.FilterInputStream {
        long count;

        CountingStream(InputStream in) {
            super(in);
        }

        @Override
        public int read() throws IOException {
            int b = super.read();
            if (b >= 0) count++;
            return b;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            int n = super.read(b, off, len);
            if (n > 0) count += n;
            return n;
        }

        @Override
        public long skip(long n) throws IOException {
            long s = super.skip(n);
            count += s;
            return s;
        }
    }
}
