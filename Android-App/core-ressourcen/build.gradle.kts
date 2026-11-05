// Texte (beide Sprachen), Schriften und die Bilder, die der Code nennt: Jedes
// Modul liest dieselbe R-Klasse (ch.brickinventoryapp.ressourcen.R), statt dass
// Texte nach dem Modul getrennt werden, das sie zuerst brauchte.
plugins {
    alias(libs.plugins.brickinventory.android.library)
}

android {
    namespace = "ch.brickinventoryapp.ressourcen"
}
