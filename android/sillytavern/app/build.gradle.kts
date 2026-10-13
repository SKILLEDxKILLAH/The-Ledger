plugins {
    id("com.android.application")
}

// The runtime ABI is chosen by scripts/prepare-runtime.sh. A Pixel 9 Pro (Tensor G4)
// is arm64-v8a only; CI also builds an x86_64 copy to boot-test on an emulator.
val stAbi = (findProperty("stAbi") as String?) ?: "arm64-v8a"
val stVersion = (findProperty("stVersion") as String?) ?: "dev"

android {
    namespace = "app.sillytavern.pocket"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.sillytavern.pocket"
        minSdk = 34
        targetSdk = 35
        versionCode = ((findProperty("stVersionCode") as String?) ?: "1").toInt()
        versionName = stVersion
        ndk { abiFilters += stAbi }
    }

    signingConfigs {
        // CI signs with a stable keystore from secrets when present so updates install
        // over the top; otherwise the debug key is used.
        create("release") {
            val ks = System.getenv("ST_KEYSTORE_FILE")
            if (ks != null && file(ks).exists()) {
                storeFile = file(ks)
                storePassword = System.getenv("ST_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ST_KEY_ALIAS")
                keyPassword = System.getenv("ST_KEY_PASSWORD")
            } else {
                initWith(getByName("debug"))
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    packaging {
        // The node binary and its libraries must be extracted to nativeLibraryDir so
        // they can be exec'd (app data dirs are not executable on Android 10+).
        jniLibs.useLegacyPackaging = true
    }

    androidResources {
        noCompress += "zip"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
