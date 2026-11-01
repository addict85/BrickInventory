pluginManagement {
    repositories {
        google { content { includeGroupByRegex("com\\.android.*"); includeGroupByRegex("com\\.google.*"); includeGroupByRegex("androidx.*") } }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "BrickInventoryManager"
include(":app")

// Abhängigkeiten nur in diese Richtung: app → feature-* → core-*; kein Bereich
// kennt einen anderen. ModulgrenzenTest prüft das an den Build-Dateien.
include(":core-model")
include(":core-ressourcen")
include(":core-data")
include(":core-ui")
include(":core-zustand")
include(":core-testing")
include(":feature-anmeldung")
include(":feature-katalog")
include(":feature-sammlung")
include(":feature-teile")
include(":feature-finanzen")
include(":feature-konto")
include(":feature-verwaltung")
