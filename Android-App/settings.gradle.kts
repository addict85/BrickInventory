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
    }
}

rootProject.name = "BrickInventoryManager"
include(":app")

// Dependencies only in this direction: app → feature-* → core-*; no area
// knows another. Among the core modules: core-update and core-services →
// core-data → core-offline → core-security → core-network → core-contract → core-model; core-navigation →
// core-state → core-session → core-data.
// The rule: build-logic/…/kanten/Modulkanten.kt (task modulkantenPruefen, ModulgrenzenTest).
include(":core-model")
include(":core-contract")
include(":core-resources")
include(":core-network")
include(":core-security")
include(":core-offline")
include(":core-data")
include(":core-update")
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
