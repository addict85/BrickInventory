// What the areas see of the data layer: repository interfaces per area, the types they speak
// (queries, results, steps) and small rules without state. No Retrofit, DataStore, Room or Hilt:
// core-data implements it, and an area that names an implementation does not compile.
plugins {
    alias(libs.plugins.brickinventory.android.library)
}

android {
    namespace = "ch.brickinventoryapp.core.dataapi"
}

dependencies {
    api(project(":core-model"))
    // Flow in the interfaces; every module that uses them brings coroutines itself.
    implementation(libs.kotlinx.coroutines.android)
}
