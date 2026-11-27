pluginManagement {
    // Convention plugins (brickinventory.android.*): the modules' shared Android block
    // lives there once instead of in every build.gradle.kts.
    includeBuild("build-logic")
    repositories {
        // Google's Android groups only from Google: a package of the same name from mavenCentral
        // or the plugin portal would not even be requested.
        exclusiveContent {
            forRepository { google() }
            filter { includeGroupByRegex("androidx\\..*"); includeGroupByRegex("com\\.android(\\..*)?"); includeGroupByRegex("com\\.google\\.android\\..*") }
        }
        google { content { includeGroupByRegex("com\\.android.*"); includeGroupByRegex("com\\.google.*"); includeGroupByRegex("androidx.*") } }
        mavenCentral()
        // Single Central edge nodes answered 404 for fresh Kotlin artifacts on CI runners;
        // Google's copy of Central is asked only then, and only for Kotlin's groups.
        maven("https://maven-central.storage-download.googleapis.com/maven2/") {
            content { includeGroupByRegex("org\\.jetbrains\\.kotlin(\\..*)?") }
        }
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        // As above: Google's groups only from Google, everything else only from mavenCentral;
        // no identically named package can sneak in through the second path.
        exclusiveContent {
            forRepository { google() }
            filter { includeGroupByRegex("androidx\\..*"); includeGroupByRegex("com\\.android(\\..*)?"); includeGroupByRegex("com\\.google\\.android\\..*") }
        }
        google { content { includeGroupByRegex("com\\.android.*"); includeGroupByRegex("com\\.google.*"); includeGroupByRegex("androidx.*") } }
        mavenCentral()
        // Single Central edge nodes answered 404 for fresh Kotlin artifacts on CI runners;
        // Google's copy of Central is asked only then, and only for Kotlin's groups.
        maven("https://maven-central.storage-download.googleapis.com/maven2/") {
            content { includeGroupByRegex("org\\.jetbrains\\.kotlin(\\..*)?") }
        }
    }
}

rootProject.name = "BrickInventoryManager"
include(":app")

// Dependencies only in this direction: app → feature-* → core-*; no area
// knows another. Among the core modules: core-services →
// core-data → core-offline → core-security → core-network → core-contract → core-model; core-navigation →
// core-state → core-session → core-data.
// The rule: build-logic/…/edges/ModuleEdges.kt (task moduleEdgesCheck, ModuleBoundariesTest).
include(":core-model")
include(":core-contract")
include(":core-resources")
include(":core-network")
include(":core-security")
include(":core-offline")
include(":core-data")
include(":core-services")
include(":core-ui")
include(":core-ui-inventory")
include(":core-session")
include(":core-state")
include(":core-navigation")
include(":core-testing")
include(":feature-login")
include(":feature-catalog")
include(":feature-collection")
include(":feature-parts")
include(":feature-finances")
include(":feature-account")
include(":feature-management")
