// The convention plugins of the modules (brickinventory.android.*). A separate
// build, included via the app's pluginManagement; it reads the same
// version catalog so that AGP and Kotlin have a number only there.
pluginManagement {
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
    }
    versionCatalogs {
        create("libs") {
            from(files("../gradle/libs.versions.toml"))
        }
    }
}

rootProject.name = "build-logic"
include(":convention")
