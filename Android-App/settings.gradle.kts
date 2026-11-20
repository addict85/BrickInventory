pluginManagement {
    // Konventions-Plugins (brickinventory.android.*): der gemeinsame Android-Block
    // der Module steht dort einmal statt in jedem build.gradle.kts.
    includeBuild("build-logic")
    repositories {
        // Googles Android-Gruppen nur von Google: Ein gleichnamiges Paket aus mavenCentral
        // oder dem Plugin-Portal würde gar nicht erst angefragt.
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
        // Wie oben: Googles Gruppen nur von Google, alles andere allein aus mavenCentral;
        // kein gleichnamiges Paket rutscht über den zweiten Weg herein.
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

// Abhängigkeiten nur in diese Richtung: app → feature-* → core-*; kein Bereich
// kennt einen anderen. Unter den Kernmodulen: core-update und core-services →
// core-data → core-offline → core-security → core-network → core-contract → core-model; core-navigation →
// core-state → core-session → core-data.
// Die Regel: build-logic/…/kanten/Modulkanten.kt (Aufgabe modulkantenPruefen, ModulgrenzenTest).
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
