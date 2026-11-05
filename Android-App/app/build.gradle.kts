import java.io.File

plugins {
    // Built-in Kotlin: Seit AGP 9 kompiliert com.android.application Kotlin
    // selbst — org.jetbrains.kotlin.android darf nicht mehr angewendet werden
    // (führt sonst zu "extension 'kotlin' already registered").
    alias(libs.plugins.brickinventory.android.application)
    alias(libs.plugins.brickinventory.android.unittests)
    alias(libs.plugins.brickinventory.android.compose)
    alias(libs.plugins.brickinventory.android.hilt)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.roborazzi)
}

// Bildschirmfotos neben die Tests, damit sie als Referenz eingecheckt werden
// können. Die CI vergleicht gegen sie, sobald welche eingecheckt sind, und
// nimmt sonst auf (android.yml, Schritt „Bildschirmfotos vergleichen oder aufnehmen?“).
roborazzi {
    outputDir.set(file("src/test/bildschirmfotos"))
}

// ── Version aus Git ───────────────────────────────────────────────────────────
// Derselbe Stand ergibt dieselbe Version, egal wann gebaut wird:
//   versionName = `git describe` am letzten Tag v* (ohne „v“), ohne Tag
//                 „<Commits>-g<Kurzhash>“
//   versionCode = VERSION_CODE_BASE + Anzahl Commits
// Die Basis liegt über allen früheren, aus der Uhrzeit gebildeten Codes (100 Mio. +
// Minuten seit 2020, Ende 2026 ≈ 103,6 Mio.), sonst lehnte Android das Update als
// Downgrade ab. Ohne Git (Quell-Archiv) gilt der feste Rückfall.
// Die CI braucht dafür die volle Historie (android.yml: fetch-depth: 0).
val VERSION_CODE_BASE = 200_000_000
fun git(vararg args: String): String? = runCatching {
    val lauf = providers.exec {
        commandLine("git", *args)
        isIgnoreExitValue = true
    }
    if (lauf.result.get().exitValue == 0) lauf.standardOutput.asText.get().trim().ifEmpty { null } else null
}.getOrNull()
val commitAnzahl: Int? = git("rev-list", "--count", "HEAD")?.toIntOrNull()
val generatedVersionName: String =
    (project.findProperty("buildVersionName") as String?)
        ?: git("describe", "--tags", "--match", "v[0-9]*")?.removePrefix("v")
        ?: commitAnzahl?.let { n -> "$n-g${git("rev-parse", "--short", "HEAD") ?: "0"}" }
        ?: "0.0.0-ohne-git"
val generatedVersionCode: Int =
    (project.findProperty("buildVersionCode") as String?)?.toIntOrNull()
        ?: (VERSION_CODE_BASE + (commitAnzahl ?: 0))

ksp {
    arg("dagger.fastInit", "enabled")
    arg("dagger.hilt.android.internal.disableAndroidSuperclassValidation", "true")
}

android {
    // Robolectric liest Ressourcen, Schriften und Manifest der App.
    testOptions.unitTests.isIncludeAndroidResources = true

    namespace  = "ch.brickinventoryapp"

    // compileSdk, minSdk und targetSdk setzt brickinventory.android.application.
    defaultConfig {
        applicationId = "ch.brickinventoryapp"
        versionCode   = generatedVersionCode
        versionName   = generatedVersionName
    }

    // ── Signatur für Release ─────────────────────────────────────────────────
    //
    // Aus UMGEBUNGSVARIABLEN, nicht aus einer Datei im Projekt (Nachtrag 121):
    // Ein Schlüsselspeicher gehört nie ins Repository, und eine
    // keystore.properties daneben wird beim nächsten `git add -A` genauso
    // versehentlich mitgenommen. Auf GitHub Actions kommen die vier Werte aus
    // den Repository-Secrets.
    //
    // Fehlen sie — also bei jedem lokalen Bau ohne gesetzte Variablen —, gibt
    // es KEINE Signaturkonfiguration und `assembleRelease` erzeugt wie bisher
    // ein unsigniertes APK. Das ist Absicht: Ein lokaler Bau soll nicht daran
    // scheitern, dass jemand die Variablen nicht gesetzt hat.
    // Zwei Quellen, in dieser Reihenfolge:
    //
    //  1. Umgebungsvariable — so liefert GitHub Actions die Werte.
    //  2. Gradle-Property — so hinterlegt man sie EINMAL lokal, in
    //     ~/.gradle/gradle.properties (Windows: C:\Users\<name>\.gradle\).
    //     Diese Datei liegt AUSSERHALB des Projekts und kann deshalb nicht
    //     versehentlich mitcommittet werden. Eine keystore.properties neben
    //     dem Buildskript wäre beim nächsten `git add -A` dabei.
    //
    // Nirgends eine Vorgabe: Ein fest eingetragenes Passwort im Buildskript
    // wäre schlimmer als gar keine Signatur, weil es aussieht, als wäre es
    // geschützt.
    fun signaturWert(umgebung: String, property: String): String? =
        System.getenv(umgebung) ?: providers.gradleProperty(property).orNull

    val schluesselDatei = signaturWert("BRICK_KEYSTORE_PFAD", "brickKeystorePfad")
        ?.let { file(it) }
        ?.takeIf { it.exists() }

    signingConfigs {
        if (schluesselDatei != null) {
            create("release") {
                storeFile     = schluesselDatei
                storePassword = signaturWert("BRICK_KEYSTORE_PASSWORT", "brickKeystorePasswort")
                keyAlias      = signaturWert("BRICK_KEY_ALIAS", "brickKeyAlias")
                keyPassword   = signaturWert("BRICK_KEY_PASSWORT", "brickKeyPasswort")
                // Wie die CI (apksigner im Job signieren): kein v1 — ab minSdk 30
                // prüft kein Gerät mehr die JAR-Signatur —, v3 für eine spätere
                // Schlüsselrotation.
                enableV1Signing = false
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        release {
            // findByName statt getByName: Ohne Schlüsselspeicher gibt es die
            // Konfiguration nicht, und `signingConfig = null` heisst
            // "unsigniert" — kein Buildfehler.
            signingConfig = signingConfigs.findByName("release")
            isMinifyEnabled = true
            // Entfernt ungenutzte Ressourcen (Icons, Layouts) aus dem APK
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    lint {
        // Lint läuft auf Release-Builds und bricht bei einem Fehler ab: Ein
        // Befund der Stufe Error ist kein Bericht, sondern ein Mangel. Warnungen
        // zählt tools/lint-zaehlen.py gegen eine Obergrenze. Keine Baseline —
        // was gemeldet wird, wird behoben.
        checkReleaseBuilds = true
        abortOnError = true
        warningsAsErrors = false
        // Ein Lauf hier prüft alle Module mit, als wären sie eins: Ressourcen aus
        // core-ressourcen gelten als benutzt, wenn ein Bereich sie liest, und der
        // Bericht bleibt die eine Datei, die tools/lint-zaehlen.py zählt.
        checkDependencies = true
    }

    packaging {
        jniLibs {
            // useLegacyPackaging = false (Standard ab minSdk 23) — bewusst NICHT
            // mehr auf true gesetzt.
            //
            // Der frühere Kommentar hier ("legacy packaging for third-party libs
            // that don't support 16KB alignment yet") beruhte auf einem
            // Missverständnis: Legacy Packaging komprimiert die .so-Dateien und
            // entpackt sie bei der Installation. An der ELF-Ausrichtung IM
            // Bibliothekskörper ändert das nichts — es verschiebt das Problem
            // nur aus dem Zip-Archiv in das Dateisystem. Unkomprimiert
            // (useLegacyPackaging = false) richtet AGP ab 8.5.1 die Dateien im
            // Archiv auf 16 KB aus, und genau das ist der empfohlene Weg.
            useLegacyPackaging = false
        }
        // Nur noch libandroidx.graphics.path.so (über Compose) lässt sich nicht
        // strippen. ML Kit ist nicht mehr gebündelt (Play-Dienste liefern das
        // Modell), CameraX 1.6.1 und DataStore 1.1.7 sind ausgerichtet — ihre
        // Einträge sind hier deshalb entfallen. Wieder aufnehmen, falls der
        // Build "Unable to strip the following libraries…" meldet.
        jniLibs.keepDebugSymbols += setOf(
            "**/libandroidx.graphics.path.so"
        )
    }
    // Die Sprache wechselt in der App (LanguageManager); im App-Bundle müssen darum
    // alle Sprachen im Basis-APK liegen, sonst fehlten die Texte der anderen.
    bundle {
        language {
            enableSplit = false
        }
    }

    buildFeatures {
        // BuildConfig wird fuer BuildConfig.DEBUG benoetigt (Logging nur im Debug-Build)
        buildConfig = true
    }
}

// ── DataStore auf EINE Fassung festnageln ─────────────────────────────────────
//
// Der Riegel bleibt, die Zahl wandert: 1.1.7 → 1.2.1 → 1.3.0. Sein Zweck war nie die
// bestimmte Nummer, sondern dass eine TRANSITIVE Anhebung (über eine andere
// Abhängigkeit) die 16-KB-Tauglichkeit nicht still wieder kaputt macht.
//
// Ob eine Fassung ausgerichtet ist, war in dieser Umgebung nicht nachzusehen —
// dl.google.com ist gesperrt, das AAR also nicht herunterladbar. Statt es zu
// hoffen, misst es jetzt die Action am GEBAUTEN APK:
// tools/apk-ausrichtung.py liest die ELF-Köpfe aller mitgelieferten .so und
// meldet jede Ausrichtung unter 16 KB. Das ist der Nachweis, den der
// Kommentar hier vorher nur verlangt hat.
configurations.configureEach {
    resolutionStrategy {
        force("androidx.datastore:datastore:1.3.0")
        force("androidx.datastore:datastore-android:1.3.0")
        force("androidx.datastore:datastore-core:1.3.0")
        force("androidx.datastore:datastore-core-android:1.3.0")
        force("androidx.datastore:datastore-preferences:1.3.0")
        force("androidx.datastore:datastore-preferences-android:1.3.0")
    }
}

// ── Feste Version für Debug-Builds ────────────────────────────────────────────
// versionCode/-Name kommen oben aus Git und wechseln mit jedem Commit; für Debug
// hiesse das: Die Manifest-Tasks wären nach jedem Commit "out of date". Die
// Variant-API überschreibt beide Felder (ein versionNameSuffix reichte nicht).
//
// versionCode = 1 liegt bewusst weit unter VERSION_CODE_BASE, damit ein
// Debug-Build nie versehentlich als Update über eine installierte
// Release-Fassung geht.
androidComponents {
    onVariants(selector().withBuildType("debug")) { variant ->
        variant.outputs.forEach { output ->
            output.versionCode.set(1)
            output.versionName.set("debug")
        }
    }
}

// ── APK-Dateiname ─────────────────────────────────────────────────────────────
// Das als Release gebaute APK soll als "BrickInventory.apk" bereitstehen
// (statt nur des Standardnamens app-release.apk). Die alte
// applicationVariants-API zum Umbenennen wurde in AGP 9 entfernt; stattdessen
// wird über die öffentliche Artifacts-API der Ausgabeordner der Release-APK
// ermittelt und die erzeugte Datei danach als BrickInventory.apk bereitgestellt.
//
// Wichtig: AGP legt neben der APK eine output-metadata.json ab, die auf den
// Originalnamen verweist. Damit nachgelagerte Schritte (Signieren, Bundle,
// Install) nicht brechen, wird die Original-APK NICHT umbenannt, sondern eine
// Kopie mit dem Wunschnamen daneben abgelegt.
//
// ── Eine Regel, eine Fassung ─────────────────────────────────────────────────
// Bis hierher gab es diese Regel ZWEIMAL, in zwei Schreibweisen: Gradle legte
// "Brickinventory.apk" ab (kleines i), der Workflow benannte danach
// app-release.apk in "BrickInventory.apk" um (grosses I). Auf Linux sind das
// zwei Dateien — im Protokoll des Laufs lagen beide nebeneinander, gleich gross.
// Hochgeladen wurde nur die des Workflows; die Gradle-Kopie war totes Gewicht,
// und die README beschrieb beide Namen an verschiedenen Stellen.
//
// Schlimmer als der doppelte Name war, was die zweite Fassung tat: Der Workflow
// verschob (mv) genau die Original-APK, die der Absatz oben ausdrücklich stehen
// lassen will. Heute geht das gut, weil Bundle und Lint vorher laufen — das ist
// aber eine Reihenfolge, auf die sich niemand verlassen sollte.
//
// Jetzt benennt nur noch Gradle; der Workflow prüft bloss, was dabei
// herausgekommen ist. Der Name steht damit an genau einer Stelle.
androidComponents {
    onVariants(selector().withBuildType("release")) { variant ->
        val apkDir = variant.artifacts.get(com.android.build.api.artifact.SingleArtifact.APK)
        val renameTask = tasks.register("copyReleaseApkAsBrickInventory") {
            inputs.dir(apkDir)
            doLast {
                val dir = apkDir.get().asFile
                val target = File(dir, "BrickInventory.apk")
                // Die Release-APK finden — unabhängig vom Standardnamen — und
                // als BrickInventory.apk kopieren.
                //
                // Die Reihenfolge ist FEST und nicht "die neueste Datei": Ohne
                // Signierschlüssel heisst die Ausgabe app-release-unsigned.apk,
                // mit Schlüssel app-release.apk. Liegen nach einem Wechsel
                // beide im Ordner, soll immer die signierte gewinnen — nach
                // Zeitstempel wäre das Zufall, und ein unsigniertes APK lässt
                // sich nicht installieren.
                val built = File(dir, "app-release.apk").takeIf { it.isFile }
                    ?: File(dir, "app-release-unsigned.apk").takeIf { it.isFile }
                    ?: dir.listFiles { f -> f.name.endsWith(".apk") && f.name != target.name }
                        ?.maxByOrNull { it.lastModified() }
                if (built != null) {
                    built.copyTo(target, overwrite = true)
                    println("Release-APK bereitgestellt als: ${target.absolutePath}")
                }
            }
        }
        // Nach dem Packen der Release-APK automatisch ausführen.
        afterEvaluate {
            tasks.findByName("package${variant.name.replaceFirstChar { it.uppercase() }}")
                ?.finalizedBy(renameTask)
        }
    }
}

dependencies {
    // Die App setzt zusammen: Navigation, Hilt-Einstieg, Widget. Alles andere
    // liegt in den Modulen darunter.
    implementation(project(":core-model"))
    implementation(project(":core-ressourcen"))
    implementation(project(":core-data"))
    implementation(project(":core-ui"))
    implementation(project(":core-zustand"))
    implementation(project(":feature-anmeldung"))
    implementation(project(":feature-katalog"))
    implementation(project(":feature-sammlung"))
    implementation(project(":feature-teile"))
    implementation(project(":feature-finanzen"))
    implementation(project(":feature-konto"))
    implementation(project(":feature-verwaltung"))
    testImplementation(project(":core-testing"))
    implementation(libs.androidx.core.ktx)
    // Startbild statt weissem Fenster beim Kaltstart (MainActivity.installSplashScreen).
    implementation(libs.androidx.core.splashscreen)
    // junit, org.json, coroutines-test und mockwebserver: brickinventory.android.unittests.
    testImplementation(libs.retrofit)
    testImplementation(libs.retrofit.kotlinx.serialization)
    // Compose-BOM und die Gruppe compose (ui, material3, hilt-navigation-compose,
    // coil-compose …): brickinventory.android.compose; Hilt: …android.hilt.
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.navigation.compose)

    // Network
    implementation(libs.retrofit)
    implementation(libs.okhttp.logging)
    implementation(libs.okhttp.sse)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.retrofit.kotlinx.serialization)

    // Storage & async
    implementation(libs.androidx.datastore)
    // WorkManager: der stuendliche Abruf der ausgeloesten Preisalarme.
    // Keine native Bibliothek — die 16-KB-Ausrichtung bleibt unberuehrt.
    implementation(libs.androidx.work)
    // Per-app language switching (AppCompatDelegate.setApplicationLocales)
    implementation(libs.androidx.appcompat)
    implementation(libs.kotlinx.coroutines.android)
    // Installiert die Baseline-Profile der Libraries (v.a. Compose) beim
    // ersten Start — AOT-kompiliert die Hot-Paths und beschleunigt den
    // Kaltstart typ. um 20-30%, ohne dass ein eigenes Profil nötig ist.
    // profileinstaller ENTFERNT (Nachtrag 118): Die Bibliothek installiert ein
    // Baseline-Profil in die ART-Laufzeit — im Baum gab es aber keins
    // (kein baseline-prof.txt, kein :macrobenchmark-Modul). Sie kostete damit
    // APK-Grösse und eine Initialisierung beim Start, ohne etwas zu tun.
    //
    // ZURÜCKHOLEN lohnt sich, sobald ein Profil da ist — bei einer
    // Compose-App mit fünfzehn Bildschirmen bringt es beim Kaltstart
    // spürbar etwas. Der Weg dahin: ein Modul :macrobenchmark mit
    // BaselineProfileRule, ein Lauf auf einem echten Gerät, das Ergebnis nach
    // app/src/main/baseline-prof.txt, dann diese Zeile wieder aktivieren:
    //   implementation(libs.androidx.profileinstaller)

    // graphics-path kommt sonst transitiv über Compose (ui-graphics) in einer
    // 1.0.x-Fassung herein, deren libandroidx.graphics.path.so 4-KB-ausgerichtet
    // ist. Hier direkt auf die neueste Linie gehoben — bewusst OHNE die
    // Compose-BOM anzufassen: graphics-path hat eine eigene Versionslinie, ein
    // BOM-Sprung wäre eine breite Änderung quer durch die gesamte Oberfläche.
    //
    // Ob 1.1.0 die Ausrichtung tatsächlich behebt, zeigt erst das fertige APK
    // (check_elf_alignment.sh / APK Analyzer). Falls nicht: Der Eintrag schadet
    // nicht und kann bleiben, bis eine ausgerichtete Fassung erscheint.
    implementation(libs.androidx.graphics.path)

    // Image loading (coil-compose kommt mit der Gruppe compose).
    // Siehe den Kommentar im Versionskatalog: Coil 3 laedt ohne dieses
    // Artefakt NICHT aus dem Netz. Das Fehlen ergaebe keine Fehlermeldung,
    // sondern leere Bildflaechen.
    implementation(libs.coil.network.okhttp)

    // Barcode scanner
    implementation(libs.camerax.core)
    implementation(libs.camerax.camera2)
    implementation(libs.camerax.lifecycle)
    implementation(libs.camerax.view)
    implementation(libs.mlkit.barcode)
    implementation(libs.mlkit.textrec)

    debugImplementation(libs.androidx.ui.tooling)

    // Startbildschirm-Widget (widget/).
    implementation(libs.glance.appwidget)
    implementation(libs.glance.material3)

    // Oberflächentests auf der JVM: Robolectric, Compose-Testregel samt
    // Barrierefreiheitsprüfung (ATF) und Roborazzi für die Bildschirmfotos.
    testImplementation(platform(libs.androidx.compose.bom))
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.ext.junit)
    testImplementation(libs.androidx.ui.test.junit4)
    testImplementation(libs.androidx.ui.test.junit4.accessibility)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.roborazzi.junit.rule)
    debugImplementation(libs.androidx.ui.test.manifest)
}
