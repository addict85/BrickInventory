import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// java-gradle-plugin with the catalog's Kotlin instead of `kotlin-dsl`: kotlin-dsl
// would bring org.gradle.kotlin and a second Kotlin set in the embedded
// version, which verification-metadata.xml does not know. That way this build only
// resolves what the app resolves anyway.
plugins {
    `java-gradle-plugin`
    alias(libs.plugins.kotlin.jvm)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

// Only for compiling: at runtime the app supplies AGP and Kotlin via the
// plugins of its root script, otherwise two versions would lie on the classpath. The
// coordinates stand here instead of under [libraries] because Lint checks the catalog
// and the app modules never use these artifacts; the version stays the catalog's.
dependencies {
    compileOnly("com.android.tools.build:gradle-api:${libs.versions.agp.get()}")
    compileOnly("org.jetbrains.kotlin:kotlin-gradle-plugin:${libs.versions.kotlin.get()}")
}

gradlePlugin {
    plugins {
        register("androidApplication") {
            id = libs.plugins.brickinventory.android.application.get().pluginId
            implementationClass = "ch.brickinventoryapp.buildlogic.AndroidApplicationConvention"
        }
        register("androidLibrary") {
            id = libs.plugins.brickinventory.android.library.get().pluginId
            implementationClass = "ch.brickinventoryapp.buildlogic.AndroidLibraryConvention"
        }
        register("androidUnittests") {
            id = libs.plugins.brickinventory.android.unittests.get().pluginId
            implementationClass = "ch.brickinventoryapp.buildlogic.AndroidUnittestConvention"
        }
        register("androidCompose") {
            id = libs.plugins.brickinventory.android.compose.get().pluginId
            implementationClass = "ch.brickinventoryapp.buildlogic.AndroidComposeConvention"
        }
        register("androidHilt") {
            id = libs.plugins.brickinventory.android.hilt.get().pluginId
            implementationClass = "ch.brickinventoryapp.buildlogic.AndroidHiltConvention"
        }
        register("androidFeature") {
            id = libs.plugins.brickinventory.android.feature.get().pluginId
            implementationClass = "ch.brickinventoryapp.buildlogic.AndroidFeatureConvention"
        }
        register("jvmLibrary") {
            id = libs.plugins.brickinventory.jvm.library.get().pluginId
            implementationClass = "ch.brickinventoryapp.buildlogic.JvmLibraryConvention"
        }
        register("detekt") {
            id = libs.plugins.brickinventory.detekt.get().pluginId
            implementationClass = "ch.brickinventoryapp.buildlogic.DetektConvention"
        }
    }
}
