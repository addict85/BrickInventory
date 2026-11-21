// Texts (both languages), fonts and the images the code refers to: every
// module reads the same R class (ch.brickinventoryapp.resources.R), instead of
// texts being split up by the module that first needed them.
plugins {
    alias(libs.plugins.brickinventory.android.library)
}

android {
    namespace = "ch.brickinventoryapp.resources"
}
