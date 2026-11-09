pluginManagement {
    // Konventions-Plugins (brickinventory.android.*): der gemeinsame Android-Block
    // der Module steht dort einmal statt in jedem build.gradle.kts.
    includeBuild("build-logic")
    repositories {
        // Googles Android-Gruppen nur von Google: Ein gleichnamiges Paket aus mavenCentral
        // oder dem Plugin-Portal würde gar nicht erst angefragt (sec17 B-N4).
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
// kennt einen anderen. Unter den Kernmodulen: core-update und core-dienste →
// core-data → core-offline → core-sicherheit → core-netz → core-model.
// ModulgrenzenTest prüft das an den Build-Dateien.
include(":core-model")
include(":core-ressourcen")
include(":core-netz")
include(":core-sicherheit")
include(":core-offline")
include(":core-data")
include(":core-update")
include(":core-dienste")
include(":core-ui")
include(":core-ui-bestand")
include(":core-zustand")
include(":core-testing")
include(":feature-anmeldung")
include(":feature-katalog")
include(":feature-sammlung")
include(":feature-teile")
include(":feature-finanzen")
include(":feature-konto")
include(":feature-verwaltung")
