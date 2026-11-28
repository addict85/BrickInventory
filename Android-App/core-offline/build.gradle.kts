// The local truth of the UI: lists and outbox per account in Room
// (SQLCipher), offline store and the local application of edits. Knows
// neither network nor repositories: sending (sync, OutboxWorker) lives in
// core-data, which builds on this (ModuleBoundariesTest).
plugins {
    alias(libs.plugins.brickinventory.android.library)
    alias(libs.plugins.brickinventory.android.unittests)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.brickinventory.android.hilt)
}

ksp {
    // Room stores the schema per version here; checked in so that a migration
    // can be checked against the earlier version (StockMigrationTest).
    arg("room.schemaLocation", "$projectDir/schemas")
}

android {
    namespace = "ch.brickinventoryapp.core.offline"
    // The Room tests run under Robolectric and read the resources.
    testOptions.unitTests.isIncludeAndroidResources = true
    // Room in memory for the tests of core-data, which may not see the database itself.
    testFixtures.enable = true
}

dependencies {
    api(project(":core-model"))
    // The database key comes from the store key.
    implementation(project(":core-security"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    implementation(libs.sqlcipher.android)
    ksp(libs.androidx.room.compiler)

    testFixturesImplementation(libs.androidx.room.runtime)
    testFixturesImplementation(libs.kotlinx.coroutines.android)
    // The tests build server responses as core-data maps them; the store itself does not know them.
    testImplementation(project(":core-contract"))
    testImplementation(testFixtures(project(":core-contract")))
    // Room-Tests laufen unter Robolectric (StockMigrationTest).
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.ext.junit)
}
