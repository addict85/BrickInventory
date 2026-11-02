package ch.brickinventoryapp.util

/**
 * Trägt das geladene APK die angekündigte Fassung, und ist sie neuer als die
 * laufende? version.json kann eine höhere Zahl nennen als das APK hinter der
 * Adresse; installiert würde dann eine alte Fassung (oder Android lehnt sie als
 * Downgrade ab), und die App böte dasselbe Update immer wieder an.
 */
fun fassungPasst(imApk: Long?, gemeldet: Int, laufend: Int): Boolean =
    imApk != null && imApk == gemeldet.toLong() && imApk > laufend
