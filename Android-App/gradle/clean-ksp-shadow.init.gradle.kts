// Gradle init script — runs before any task, deletes stale KSP byRounds directory.
// Place this file in the project root gradle/ folder and reference it from gradle.properties:
//   org.gradle.init.scripts=gradle/clean-ksp-shadow.init.gradle.kts
//
// This fixes: NoSuchFileException: byRounds/1/...BrickInventoryApp_GeneratedInjector.java
// on Windows NTFS caused by KSP's shadow-copy mechanism leaving stale directories.

gradle.taskGraph.whenReady {
    allprojects {
        val kspOut = layout.buildDirectory.dir("generated/ksp").get().asFile
        if (kspOut.exists()) {
            kspOut.walkTopDown()
                .filter  { it.isDirectory && it.name == "byRounds" }
                .forEach {
                    println("[ksp-fix] Deleting stale shadow dir: ${it.absolutePath}")
                    it.deleteRecursively()
                }
        }
    }
}
