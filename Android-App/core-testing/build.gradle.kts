// Reading source code for the structural checks of all modules (Sources). Knows no
// module: fixtures that need one live in that module's testFixtures.
plugins {
    alias(libs.plugins.brickinventory.android.library)
}

android {
    namespace = "ch.brickinventoryapp.core.testing"
}
