// Die Konventions-Plugins der Module (brickinventory.android.*). Ein eigener
// Bau, eingebunden über pluginManagement der App; er liest denselben
// Versionskatalog, damit AGP und Kotlin nur dort eine Nummer haben.
pluginManagement {
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
        // Googles Android-Gruppen nur von Google: Ein gleichnamiges Paket aus mavenCentral
        // oder dem Plugin-Portal würde gar nicht erst angefragt (sec17 B-N4).
        exclusiveContent {
            forRepository { google() }
            filter { includeGroupByRegex("androidx\\..*"); includeGroupByRegex("com\\.android(\\..*)?"); includeGroupByRegex("com\\.google\\.android\\..*") }
        }
        google { content { includeGroupByRegex("com\\.android.*"); includeGroupByRegex("com\\.google.*"); includeGroupByRegex("androidx.*") } }
        mavenCentral()
    }
    versionCatalogs {
        create("libs") {
            from(files("../gradle/libs.versions.toml"))
        }
    }
}

rootProject.name = "build-logic"
include(":convention")
