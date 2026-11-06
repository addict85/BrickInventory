import com.android.build.api.artifact.SingleArtifact
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

// Version aus Git, damit derselbe Stand dieselbe Version ergibt: versionName aus
// `git describe` (Tag v*), versionCode = Basis + Anzahl Commits. Die Basis liegt über
// den früheren, aus der Uhrzeit gebildeten Codes, sonst wäre ein Update ein Downgrade.
// Die CI klont dafür die volle Historie (android.yml: fetch-depth: 0).
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

    // Signatur aus Umgebungsvariablen oder ~/.gradle/gradle.properties, nie aus einer
    // Datei im Projekt: Die läge beim nächsten `git add -A` im Repository. Ohne Werte
    // entsteht ein unsigniertes APK, damit ein lokaler Bau nicht daran scheitert. Eine
    // Vorgabe gibt es nicht; ein fest eingetragenes Passwort sähe nur geschützt aus.
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
            // Unkomprimiert richtet AGP die .so im Archiv auf 16 KB aus; Legacy Packaging
            // verschöbe das Problem nur ins Dateisystem des Geräts.
            useLegacyPackaging = false
        }
        // Nur libandroidx.graphics.path.so (über Compose) lässt sich nicht strippen. Weitere
        // aufnehmen, falls der Bau „Unable to strip the following libraries…“ meldet.
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

// DataStore auf die Fassung des Katalogs festnageln: Eine transitive Anhebung ergäbe
// ein anderes APK als das geprüfte. Die 16-KB-Ausrichtung misst tools/apk-ausrichtung.py
// am gebauten APK.
val datastore = libs.versions.datastore.get()
configurations.configureEach {
    resolutionStrategy {
        listOf(
            "datastore", "datastore-android", "datastore-core", "datastore-core-android",
            "datastore-preferences", "datastore-preferences-android",
        ).forEach { force("androidx.datastore:$it:$datastore") }
    }
}

// Debug-Builds mit fester Version: Aus Git wären die Manifest-Aufgaben nach jedem Commit
// veraltet. versionCode 1 liegt unter jeder Release-Fassung, damit ein Debug-Build nie
// als Update über eine installierte Release-Fassung geht.
androidComponents {
    onVariants(selector().withBuildType("debug")) { variant ->
        variant.outputs.forEach { output ->
            output.versionCode.set(1)
            output.versionName.set("debug")
        }
    }
}

// Das Release-APK zusätzlich als BrickInventory.apk daneben; das Original bleibt, weil
// output-metadata.json darauf zeigt. Nur Gradle vergibt den Namen, der Workflow prüft ihn.
androidComponents {
    onVariants(selector().withBuildType("release")) { variant ->
        val apkDir = variant.artifacts.get(SingleArtifact.APK)
        val renameTask = tasks.register("copyReleaseApkAsBrickInventory") {
            // Ein- und Ausgabe benannt: Ohne Änderung bleibt die Aufgabe UP-TO-DATE.
            inputs.files(apkDir.map { it.asFileTree.matching { exclude("BrickInventory.apk") } })
            outputs.file(apkDir.map { it.file("BrickInventory.apk") })
            doLast {
                val dir = apkDir.get().asFile
                val target = File(dir, "BrickInventory.apk")
                // Signiert vor unsigniert: Liegen nach einem Schlüsselwechsel beide da,
                // gewinnt die installierbare, nicht die neueste.
                val built = File(dir, "app-release.apk").takeIf { it.isFile }
                    ?: File(dir, "app-release-unsigned.apk").takeIf { it.isFile }
                    ?: dir.listFiles { f -> f.name.endsWith(".apk") && f.name != target.name }
                        ?.maxByOrNull { it.lastModified() }
                if (built != null) built.copyTo(target, overwrite = true)
            }
        }
        // Nach dem Packen der Release-APK ausführen; matching statt afterEvaluate,
        // damit die Aufgabe erst angelegt wird, wenn sie gebraucht wird.
        val packen = "package${variant.name.replaceFirstChar { it.uppercase() }}"
        tasks.matching { it.name == packen }.configureEach { finalizedBy(renameTask) }
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
    // junit, org.json, coroutines-test und mockwebserver: brickinventory.android.unittests;
    // Retrofit samt Konverter kommt mit core-testing.
    // Compose-BOM und die Gruppe compose (ui, material3, hilt-navigation-compose,
    // coil-compose …): brickinventory.android.compose; Hilt: …android.hilt.
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.navigation.compose)

    // Netz, DataStore, Kamera und ML Kit bringen core-data und die Features mit;
    // hier steht nur, was app/src/main selbst importiert.
    implementation(libs.kotlinx.serialization.json)
    // WorkManager: der stuendliche Abruf der ausgeloesten Preisalarme.
    // Keine native Bibliothek — die 16-KB-Ausrichtung bleibt unberuehrt.
    implementation(libs.androidx.work)
    // HiltWorkerFactory in BrickInventoryApp, @HiltWorker beim Widget-Arbeiter.
    implementation(libs.androidx.hilt.work)
    ksp(libs.androidx.hilt.compiler)
    // Per-app language switching (AppCompatDelegate.setApplicationLocales)
    implementation(libs.androidx.appcompat)
    implementation(libs.kotlinx.coroutines.android)

    // kostet er nur Grösse und eine Initialisierung beim Start.

    // graphics-path käme über Compose in einer 1.0.x-Fassung mit 4-KB-ausgerichteter .so.
    // Direkt gehoben statt über die BOM, die die ganze Oberfläche verschöbe.
    implementation(libs.androidx.graphics.path)

    // Coil 3 lädt ohne dieses Artefakt nicht aus dem Netz, und zwar ohne Fehlermeldung:
    // Die Bildflächen blieben leer.
    implementation(libs.coil.network.okhttp)

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
