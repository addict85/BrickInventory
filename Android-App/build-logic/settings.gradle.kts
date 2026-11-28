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
    }
    versionCatalogs {
        create("libs") {
            from(files("../gradle/libs.versions.toml"))
        }
    }
}

rootProject.name = "build-logic"
include(":convention")
