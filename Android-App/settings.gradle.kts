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
        // Google's copy of Central first: on shared CI runners Central answered 429 or broke off,
        // and Gradle does not fall through to the next repository on an error, only on a miss.
        // Checksums and signatures (verification-metadata.xml) check every file, whichever copy served it.
        maven("https://maven-central.storage-download.googleapis.com/maven2/") { name = "CentralMirror" }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        // As above: Google's groups only from Google, everything else only from Central (mirror, then origin);
        // no identically named package can sneak in through the second path.
        exclusiveContent {
            forRepository { google() }
            filter { includeGroupByRegex("androidx\\..*"); includeGroupByRegex("com\\.android(\\..*)?"); includeGroupByRegex("com\\.google\\.android\\..*") }
        }
        google { content { includeGroupByRegex("com\\.android.*"); includeGroupByRegex("com\\.google.*"); includeGroupByRegex("androidx.*") } }
        // Google's copy of Central first: on shared CI runners Central answered 429 or broke off,
        // and Gradle does not fall through to the next repository on an error, only on a miss.
        // Checksums and signatures (verification-metadata.xml) check every file, whichever copy served it.
        maven("https://maven-central.storage-download.googleapis.com/maven2/") { name = "CentralMirror" }
        mavenCentral()
    }
}

rootProject.name = "BrickInventoryManager"
include(":app")

// Dependencies only in this direction: app → feature-* → core-*; no area
// knows another, and an area sees the data layer only through core-data-api. Among the core
// modules: core-services → core-data → core-data-api, core-offline → core-security → core-network →
// core-model; core-navigation → core-state → core-session → core-data; core-ui → core-ui-state → core-model.
// The rule: build-logic/…/edges/ModuleEdges.kt (task moduleEdgesCheck, ModuleBoundariesTest).
include(":core-model")
include(":core-ui-state")
include(":core-contract")
include(":core-resources")
include(":core-network")
include(":core-security")
include(":core-offline")
include(":core-data-api")
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
