import com.android.build.api.artifact.SingleArtifact
import java.io.File

plugins {
    // Built-in Kotlin: since AGP 9 com.android.application compiles Kotlin
    // itself — org.jetbrains.kotlin.android must no longer be applied
    // (otherwise leads to "extension 'kotlin' already registered").
    alias(libs.plugins.brickinventory.android.application)
    alias(libs.plugins.brickinventory.android.unittests)
    alias(libs.plugins.brickinventory.android.compose)
    alias(libs.plugins.brickinventory.android.hilt)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.roborazzi)
}

// Screenshots next to the tests so that they can be checked in as reference.
// CI compares against them as soon as some are checked in, and
// records otherwise (android.yml, step „Bildschirmfotos vergleichen oder aufnehmen?“).
roborazzi {
    outputDir.set(file("src/test/screenshots"))
}

// Version from Git so that the same state yields the same version: versionName from
// `git describe` (tag v*), versionCode = base + number of commits. The base lies above
// the earlier codes formed from the clock, otherwise an update would be a downgrade.
// CI clones the full history for that (android.yml: fetch-depth: 0).
val VERSION_CODE_BASE = 200_000_000
fun git(vararg args: String): String? = runCatching {
    val jobRun = providers.exec {
        commandLine("git", *args)
        isIgnoreExitValue = true
    }
    if (jobRun.result.get().exitValue == 0) jobRun.standardOutput.asText.get().trim().ifEmpty { null } else null
}.getOrNull()
val commitCount: Int? = git("rev-list", "--count", "HEAD")?.toIntOrNull()
val generatedVersionName: String =
    (project.findProperty("buildVersionName") as String?)
        ?: git("describe", "--tags", "--match", "v[0-9]*")?.removePrefix("v")
        ?: commitCount?.let { n -> "$n-g${git("rev-parse", "--short", "HEAD") ?: "0"}" }
        ?: "0.0.0-ohne-git"
val generatedVersionCode: Int =
    (project.findProperty("buildVersionCode") as String?)?.toIntOrNull()
        ?: (VERSION_CODE_BASE + (commitCount ?: 0))

ksp {
    arg("dagger.fastInit", "enabled")
    arg("dagger.hilt.android.internal.disableAndroidSuperclassValidation", "true")
}

android {
    // Robolectric reads the app's resources, fonts and manifest.
    testOptions.unitTests.isIncludeAndroidResources = true
    // The app's graphs with sample world and test ViewModels, for every test that runs a destination.
    testFixtures.enable = true
    // ModuleBoundariesTest runs the same edge rule as the task moduleEdgesCheck.
    sourceSets.getByName("test").kotlin.directories.add("../build-logic/convention/src/main/kotlin/ch/brickinventoryapp/buildlogic/edges")

    namespace  = "ch.brickinventoryapp"

    // compileSdk, minSdk and targetSdk are set by brickinventory.android.application.
    defaultConfig {
        applicationId = "ch.brickinventoryapp"
        versionCode   = generatedVersionCode
        versionName   = generatedVersionName
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // Device tests on an emulator that Gradle creates itself (android.yml, job
    // geraetetests): ATD image without Play, only the debug variant, nothing signed.
    testOptions.managedDevices.allDevices.create("pixel6Api34", com.android.build.api.dsl.ManagedVirtualDevice::class.java) {
        device = "Pixel 6"
        apiLevel = 34
        systemImageSource = "aosp-atd"
    }

    // Signature from environment variables or ~/.gradle/gradle.properties, never from a
    // file in the project: it would end up in the repository on the next `git add -A`. Without values
    // an unsigned APK is built so that a local build does not fail on it. There is
    // no default; a hard-coded password would only look protected.
    fun signatureValue(environment: String, property: String): String? =
        System.getenv(environment) ?: providers.gradleProperty(property).orNull

    val keyFile = signatureValue("BRICK_KEYSTORE_PFAD", "brickKeystorePfad")
        ?.let { file(it) }
        ?.takeIf { it.exists() }

    signingConfigs {
        if (keyFile != null) {
            create("release") {
                storeFile     = keyFile
                storePassword = signatureValue("BRICK_KEYSTORE_PASSWORT", "brickKeystorePasswort")
                keyAlias      = signatureValue("BRICK_KEY_ALIAS", "brickKeyAlias")
                keyPassword   = signatureValue("BRICK_KEY_PASSWORT", "brickKeyPasswort")
                // Like CI (apksigner in the signing job): no v1 — from minSdk 30
                // no device checks the JAR signature any more —, v3 for a later
                // key rotation.
                enableV1Signing = false
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        // Its own package next to the release: a debug build (debuggable, run-as can read
        // its files) never replaces the signed app or reaches its data, and Play rejects it.
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            // findByName instead of getByName: without a keystore the configuration
            // does not exist, and `signingConfig = null` means
            // "unsigned" — no build error.
            signingConfig = signingConfigs.findByName("release")
            isMinifyEnabled = true
            // Removes unused resources (icons, layouts) from the APK
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    lint {
        // Lint runs on release builds and aborts on an error: a
        // finding of level Error is not a report but a defect. Warnings
        // are counted by `tools/lint-count.py` against an upper limit. No baseline —
        // what is reported gets fixed.
        checkReleaseBuilds = true
        abortOnError = true
        warningsAsErrors = false
        // A run here checks all modules as if they were one: resources from
        // core-resources count as used when an area reads them, and the
        // report stays the one file that `tools/lint-count.py` counts.
        checkDependencies = true
    }

    packaging {
        jniLibs {
            // Uncompressed, AGP aligns the .so in the archive to 16 KB; legacy packaging
            // would only move the problem into the device's file system.
            useLegacyPackaging = false
        }
        // Only libandroidx.graphics.path.so (via Compose) cannot be stripped. Add more
        // if the build reports „Unable to strip the following libraries…“.
        jniLibs.keepDebugSymbols += setOf(
            "**/libandroidx.graphics.path.so"
        )
    }
    // The language switches inside the app (LanguageManager); in the app bundle all
    // languages must therefore be in the base APK, otherwise the others' texts would be missing.
    bundle {
        language {
            enableSplit = false
        }
    }

    buildFeatures {
        // BuildConfig is needed for BuildConfig.DEBUG (logging only in the debug build)
        buildConfig = true
    }
}

// Pin DataStore to the catalog's version: a transitive bump would yield
// an APK different from the checked one. The 16 KB alignment is measured by `tools/apk-alignment.py`
// on the built APK.
val datastore = libs.versions.datastore.get()
configurations.configureEach {
    resolutionStrategy {
        listOf(
            "datastore", "datastore-android", "datastore-core", "datastore-core-android",
            "datastore-preferences", "datastore-preferences-android",
        ).forEach { force("androidx.datastore:$it:$datastore") }
    }
}

// Debug builds with a fixed version: from Git the manifest tasks would be stale after every
// commit. versionCode 1 lies below every release version so that a debug build never
// goes as an update over an installed release version.
androidComponents {
    onVariants(selector().withBuildType("debug")) { variant ->
        variant.outputs.forEach { output ->
            output.versionCode.set(1)
            output.versionName.set("debug")
        }
    }
}

// The release APK additionally as BrickInventory.apk next to it; the original stays because
// output-metadata.json points to it. Only Gradle assigns the name, the workflow checks it.
androidComponents {
    onVariants(selector().withBuildType("release")) { variant ->
        val apkDir = variant.artifacts.get(SingleArtifact.APK)
        val renameTask = tasks.register("copyReleaseApkAsBrickInventory") {
            // Input and output named: without a change the task stays UP-TO-DATE.
            inputs.files(apkDir.map { it.asFileTree.matching { exclude("BrickInventory.apk") } })
            outputs.file(apkDir.map { it.file("BrickInventory.apk") })
            doLast {
                val dir = apkDir.get().asFile
                val target = File(dir, "BrickInventory.apk")
                // Signed before unsigned: if both lie there after a key change,
                // the installable one wins, not the newest.
                val built = File(dir, "app-release.apk").takeIf { it.isFile }
                    ?: File(dir, "app-release-unsigned.apk").takeIf { it.isFile }
                    ?: dir.listFiles { f -> f.name.endsWith(".apk") && f.name != target.name }
                        ?.maxByOrNull { it.lastModified() }
                if (built != null) built.copyTo(target, overwrite = true)
            }
        }
        // Run after packaging the release APK; matching instead of afterEvaluate
        // so that the task is only created when it is needed.
        val pack = "package${variant.name.replaceFirstChar { it.uppercase() }}"
        tasks.matching { it.name == pack }.configureEach { finalizedBy(renameTask) }
    }
}

dependencies {
    // The app assembles: navigation, Hilt entry point, widget. Everything else
    // lives in the modules below.
    implementation(project(":core-model"))
    implementation(project(":core-resources"))
    implementation(project(":core-data"))
    // Logging and NetworkPolicy.
    implementation(project(":core-network"))
    implementation(project(":core-security"))
    implementation(project(":core-services"))
    implementation(project(":core-ui"))
    implementation(project(":core-ui-inventory"))
    implementation(project(":core-state"))
    implementation(project(":core-navigation"))
    implementation(project(":core-session"))
    implementation(project(":feature-login"))
    implementation(project(":feature-catalog"))
    implementation(project(":feature-collection"))
    implementation(project(":feature-parts"))
    implementation(project(":feature-finances"))
    implementation(project(":feature-account"))
    implementation(project(":feature-management"))
    testImplementation(project(":core-testing"))
    testImplementation(testFixtures(project(":core-state")))
    // The fixtures compile against what the unit tests bring anyway; compileOnly, so the device
    // tests (which see test fixtures too) get no Robolectric or test server on their classpath.
    testFixturesCompileOnly(testFixtures(project(":core-state")))
    testFixturesCompileOnly(platform(libs.androidx.compose.bom))
    for (lib in listOf(libs.robolectric, libs.androidx.ui.test.junit4, libs.androidx.test.ext.junit,
        libs.androidx.navigation.compose, libs.coil.compose, libs.hilt.android)) {
        testFixturesCompileOnly(lib)
    }
    for (m in listOf(":core-model", ":core-resources", ":core-data", ":core-security", ":core-services", ":core-ui",
        ":core-state", ":core-session", ":feature-collection", ":feature-parts", ":feature-finances", ":feature-account")) {
        testFixturesCompileOnly(project(m))
    }
    // The same lower bounds as for the module's other classpaths (build-logic, androidxAtLeast).
    for (lib in listOf(libs.androidx.arch.core.common, libs.androidx.arch.core.runtime, libs.androidx.tracing,
        libs.androidx.emoji2, libs.androidx.emoji2.views.helper, libs.androidx.activity.ktx)) {
        constraints.add("testFixturesCompileOnly", lib)
    }
    constraints.add("testFixturesCompileOnly", "com.google.guava:guava:${libs.versions.guavaAtLeast.get()}")
    // The test servers respond in wire format.
    testImplementation(project(":core-contract"))
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.runner)
    // DevicesProtectionTest builds the TokenStore on its own DataStore.
    testImplementation(libs.androidx.datastore)
    implementation(libs.androidx.core.ktx)
    // Splash screen instead of a white window on cold start (MainActivity.installSplashScreen).
    implementation(libs.androidx.core.splashscreen)
    // junit, org.json, coroutines-test and mockwebserver: brickinventory.android.unittests;
    // Retrofit including converters comes with core-testing.
    // Compose BOM and the compose group (ui, material3, hilt-navigation-compose,
    // coil-compose …): brickinventory.android.compose; Hilt: …android.hilt.
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.navigation.compose)

    // Network, DataStore, camera and ML Kit come with core-data and the features;
    // only what app/src/main imports itself is listed here.
    implementation(libs.kotlinx.serialization.json)
    // WorkManager: the hourly fetch of the triggered price alerts.
    // No native library — the 16 KB alignment stays untouched.
    implementation(libs.androidx.work)
    // HiltWorkerFactory in BrickInventoryApp, @HiltWorker beim Widget-Arbeiter.
    implementation(libs.androidx.hilt.work)
    ksp(libs.androidx.hilt.compiler)
    // Per-app language switching (AppCompatDelegate.setApplicationLocales)
    implementation(libs.androidx.appcompat)
    implementation(libs.kotlinx.coroutines.android)

    // it only costs size and an initialization at start.

    // graphics-path would come via Compose in a 1.0.x version with a 4 KB aligned .so.
    // Raised directly instead of via the BOM, which would shift the whole UI.
    implementation(libs.androidx.graphics.path)

    // Without this artifact Coil 3 does not load from the network, and without an error message:
    // the image areas would stay empty.
    implementation(libs.coil.network.okhttp)

    debugImplementation(libs.androidx.ui.tooling)

    // Startbildschirm-Widget (widget/).
    implementation(libs.glance.appwidget)
    implementation(libs.glance.material3)

    // UI tests on the JVM: Robolectric, Compose test rule including
    // accessibility checks (ATF) and Roborazzi for the screenshots.
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
