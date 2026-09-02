import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.io.File

plugins {
    // Built-in Kotlin: Seit AGP 9 kompiliert com.android.application Kotlin
    // selbst — org.jetbrains.kotlin.android darf nicht mehr angewendet werden
    // (führt sonst zu "extension 'kotlin' already registered").
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.hilt)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

// ── Automatische Versionierung ────────────────────────────────────────────────
// Bei jedem Build wird die Version aus dem aktuellen Zeitpunkt erzeugt:
//   versionName = "YYYY.MM.DD.HHMM"  (z. B. 2026.07.08.1430)
//   versionCode = BASIS + Minuten seit 2020-01-01 UTC  (monoton steigend)
// "xxxx" (HHMM) ist ein natürlich aufsteigender 4-stelliger Build-Stempel.
//
// Der Basis-Offset ist nötig, weil frühere Builds den festen versionCode
// 20260708 (YYYYMMDD ≈ 20 Mio.) hatten. Ein reiner "Minuten seit 2020"-Wert
// (~3,4 Mio.) wäre KLEINER → Android lehnt das Update als Downgrade ab
// (INSTALL_FAILED_VERSION_DOWNGRADE). 100 Mio. liegt sicher darüber und lässt
// bis weit über das Jahr 5000 Luft (Grenze: 2,1 Mrd.).
val VERSION_CODE_BASE = 100_000_000L
val buildClock: LocalDateTime = LocalDateTime.now()
val generatedVersionName: String =
    (project.findProperty("buildVersionName") as String?)
        ?: buildClock.format(DateTimeFormatter.ofPattern("yyyy.MM.dd.HHmm"))
val generatedVersionCode: Int =
    (project.findProperty("buildVersionCode") as String?)?.toIntOrNull()
        ?: run {
            val epoch2020 = LocalDateTime.of(2020, 1, 1, 0, 0)
                .toEpochSecond(ZoneOffset.UTC)
            val nowSec = buildClock.toEpochSecond(ZoneOffset.UTC)
            (VERSION_CODE_BASE + (nowSec - epoch2020) / 60L).toInt()
        }

ksp {
    arg("dagger.fastInit", "enabled")
    arg("dagger.hilt.android.internal.disableAndroidSuperclassValidation", "true")
}

android {
    // JVM-Unit-Tests: android.util.Log & Co. sind im Test-Jar nur Attrappen und
    // WERFEN standardmässig ("Method w in android.util.Log not mocked").
    // NetworkPolicy.isCleartextAllowed() protokolliert eine Warnung — der Test
    // scheiterte deshalb an der Protokollzeile, nicht an der geprüften Regel.
    // returnDefaultValues lässt solche Aufrufe still ins Leere laufen.
    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    namespace  = "ch.brickinventoryapp"
    // compileSdk = targetSdk: gegen SDK 36 (Android 16) kompilieren UND das
    // Verhalten von 36 übernehmen. Ein compileSdk über dem targetSdk wäre
    // ebenfalls zulässig, verdeckt aber, welche Verhaltensänderungen bereits
    // aktiv sind — hier bewusst gleichgezogen.
    compileSdk = 36

    defaultConfig {
        applicationId = "ch.brickinventoryapp"
        minSdk        = 26
        // targetSdk 36 (Android 16). Relevante Verhaltensänderungen gegenüber 35:
        //  - Vorhersagendes Zurück ("predictive back") ist standardmässig AN.
        //    Unkritisch hier: Die App hat keinen einzigen BackHandler und
        //    überlässt Zurück komplett der Navigation-Compose-Voreinstellung.
        //    Falls die Animation doch stört, unten im Manifest
        //    android:enableOnBackInvokedCallback auf "false" setzen.
        //  - Bildschirmausrichtung lässt sich auf grossen Displays nicht mehr
        //    erzwingen. Ebenfalls unkritisch: Das Manifest setzt weder
        //    screenOrientation noch resizeableActivity.
        //  - Edge-to-edge war schon unter 35 erzwungen, ändert sich also nicht.
        targetSdk     = 36
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
                // Beide Schemata: v1 für Android 6 und älter (minSdk ist 26,
                // also eigentlich entbehrlich), v2/v3 für alles darüber.
                enableV1Signing = true
                enableV2Signing = true
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

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        // Lint LÄUFT auf Release-Builds — nur bricht sie den Build nicht ab.
        //
        // Vorher stand hier checkReleaseBuilds = false: Damit war die Prüfung
        // genau dort abgeschaltet, wo sie zählt, und Befunde tauchten nirgends
        // auf. abortOnError = false erzeugt den Report weiterhin
        // (build/reports/lint-results-release.html), ohne den Build zu blockieren.
        checkReleaseBuilds = true
        abortOnError = false
        warningsAsErrors = false
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
    buildFeatures {
        compose = true
        // BuildConfig wird fuer BuildConfig.DEBUG benoetigt (Logging nur im Debug-Build)
        buildConfig = true
    }
}

// ── DataStore auf 1.1.7 festnageln ────────────────────────────────────────────
// 1.1.7 liefert libdatastore_shared_counter.so 16-KB-ausgerichtet, 1.2.0 wieder
// NICHT — dort ist die Ausrichtung zurückgefallen. Eine transitive Anhebung
// (über eine andere Abhängigkeit) würde die 16-KB-Tauglichkeit still wieder
// kaputt machen, deshalb hier erzwungen statt nur deklariert.
//
// Vor dem Entfernen dieses Blocks prüfen, ob die dann gezogene Fassung
// ausgerichtet ist — siehe INVARIANTEN.md, Abschnitt "16-KB-Speicherseiten".
configurations.configureEach {
    resolutionStrategy {
        force("androidx.datastore:datastore:1.1.7")
        force("androidx.datastore:datastore-android:1.1.7")
        force("androidx.datastore:datastore-core:1.1.7")
        force("androidx.datastore:datastore-core-android:1.1.7")
        force("androidx.datastore:datastore-preferences:1.1.7")
        force("androidx.datastore:datastore-preferences-android:1.1.7")
    }
}

// ── Feste Version für Debug-Builds ────────────────────────────────────────────
// versionCode/-Name werden oben aus LocalDateTime.now() erzeugt. Für Release
// ist das gewollt (monoton steigend, kein Downgrade beim Update), für Debug
// bedeutet es aber: Die Manifest-Tasks sind bei JEDEM Build "out of date",
// auch wenn sich nichts geändert hat — Gradle kann nichts wiederverwenden.
//
// Über buildTypes { debug { … } } liesse sich nur ein versionNameSuffix
// setzen, nicht der Name selbst; der wechselte dann weiterhin minütlich.
// Die Variant-API überschreibt beide Felder.
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

// Ersetzt das veraltete kotlinOptions { jvmTarget = "17" } im android-Block
// (Deprecation-Warnung seit Kotlin 2.x, wird mit KGP 3.0 entfernt).
kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
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
    implementation(libs.androidx.core.ktx)
    testImplementation(libs.junit)
    // Nachtrag 117: Damit Verhalten prüfbar wird statt nur Quelltext.
    //  - coroutines-test: runTest für suspend-Funktionen, ohne Thread.sleep
    //  - mockwebserver: ein echter HTTP-Server im Test. Damit lässt sich die
    //    Fehlerabbildung des Repositories gegen echte Antworten prüfen —
    //    404 mit Fehlerrumpf, 500 ohne, Zeitüberschreitung, leerer Rumpf.
    //    Kommt aus derselben OkHttp-Version wie der Produktionsclient, es gibt
    //    also keine zweite Netzwerkbibliothek im Testpfad.
    // org.json — NUR für Tests.
    //
    // BrickRepository liest den Fehlerrumpf des Servers mit
    // org.json.JSONObject. Auf dem Gerät ist das die Fassung aus Android; im
    // JVM-Test liefert android.jar nur eine Attrappe, und zusammen mit
    // testOptions { unitTests.isReturnDefaultValues = true } gibt
    // optString("error") stillschweigend "" zurück statt zu parsen.
    //
    // Folge: BrickRepositoryErrorMappingTest sah nie die Servermeldung und
    // meldete rot, obwohl App UND Test richtig sind. Diese echte Fassung liegt
    // im Klassenpfad VOR android.jar und macht die Prüfung damit aussagekräftig.
    //
    // Alternative wäre, im Repository auf kotlinx.serialization umzustellen
    // (ohnehin Abhängigkeit) — das wäre eine Änderung am Produktionscode und
    // gehört nicht in denselben Schritt wie das Reparieren der Tests.
    testImplementation(libs.json)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.retrofit)
    testImplementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    implementation(libs.androidx.navigation.compose)

    // Hilt — KSP (kein kapt mehr)
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)

    // Network
    implementation(libs.retrofit)
    implementation(libs.okhttp.logging)
    implementation(libs.okhttp.sse)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.retrofit.kotlinx.serialization)

    // Storage & async
    implementation(libs.androidx.datastore)
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

    // Image loading
    implementation(libs.coil.compose)

    // Barcode scanner
    implementation(libs.camerax.core)
    implementation(libs.camerax.camera2)
    implementation(libs.camerax.lifecycle)
    implementation(libs.camerax.view)
    implementation(libs.mlkit.barcode)
    implementation(libs.mlkit.textrec)
    implementation(libs.accompanist.permissions)

    debugImplementation(libs.androidx.ui.tooling)
}
