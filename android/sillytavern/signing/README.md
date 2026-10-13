# Release signing

`release.p12.enc` is Ledger Tavern's permanent signing key (PKCS#12, alias `st`),
encrypted with AES-256-CBC (PBKDF2, 600,000 iterations). The password lives only in
the repository secret `ST_KEYSTORE_PASSWORD`, and it is also the keystore password.

Every release is signed with this key, so updates install over the previous
version and keep the app's data. The release job refuses to publish an APK
whose certificate doesn't match `release-cert.sha256`.

Decrypt locally (you'll be prompted for the password):

```sh
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in release.p12.enc -out release.p12
```

If the password is lost, the key is gone too: new builds would need a new key, and
installing them would mean uninstalling the old app first.
