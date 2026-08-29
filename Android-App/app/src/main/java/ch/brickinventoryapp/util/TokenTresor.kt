package ch.brickinventoryapp.util

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Verschlüsselung für das Bearer-Token.
 *
 * ── Warum es das gibt (Nachtrag 155) ────────────────────────────────────────
 *
 * Das Token lag als Klartext im DataStore — einer gewöhnlichen Datei im
 * privaten App-Verzeichnis. Es öffnet ein Konto auf dem Server, und es läuft
 * erst nach TOKEN_IDLE_DAYS Untätigkeit ab.
 *
 * `allowBackup="false"` im Manifest verschliesst den grössten Weg (`adb
 * backup`). Was bleibt: ein gerootetes Gerät, ein Wiederherstellungs-Abbild,
 * ein Auslesen des Datenverzeichnisses über eine andere Lücke. In all diesen
 * Fällen ist Klartext sofort verwendbar, Geheimtext nicht — der Schlüssel
 * verlässt den Android-Keystore nie und ist an dieses Gerät gebunden.
 *
 * ── Warum eine eigene Hülle statt androidx.security ─────────────────────────
 *
 * EncryptedSharedPreferences wäre der bekannte Weg. Ob die Bibliothek noch
 * gepflegt wird, liess sich in der Umgebung, in der diese Änderung entstand,
 * nicht nachprüfen (Zugriff auf dl.google.com gesperrt) — und eine Behauptung
 * dazu wäre geraten gewesen.
 *
 * Diese Hülle braucht sie nicht: AES/GCM und der Keystore sind seit API 23
 * Teil der Plattform, minSdk ist 26. Siebzig Zeilen, die jemand lesen kann,
 * statt einer Abhängigkeit, deren Zustand niemand kennt.
 *
 * ── Was passiert, wenn der Schlüssel weg ist ────────────────────────────────
 *
 * Der Keystore-Schlüssel überlebt keine Datenwiederherstellung auf ein anderes
 * Gerät und kein Zurücksetzen der App-Daten. Dann schlägt das Entschlüsseln
 * fehl, und das ist KEIN Fehlerfall, den man verstecken sollte: Es bedeutet
 * "kein gültiges Token da". Der Aufrufer bekommt null und die Anmeldemaske —
 * ärgerlich, aber richtig. Die Alternative wäre, still auf Klartext
 * zurückzufallen, und das hebt den Sinn der Übung auf.
 */
interface TokenVerschluesselung {
    /** Klartext → speicherbare Zeichenkette. Wirft, wenn die Plattform nicht kann. */
    fun verschluessle(klartext: String): String

    /** Gespeicherte Zeichenkette → Klartext, oder null wenn sie nicht lesbar ist. */
    fun entschluessle(gespeichert: String): String?
}

/**
 * Die echte Umsetzung über den Android-Keystore.
 *
 * Ablageformat: Base64( IV ‖ Geheimtext ). Der IV steht vorne, weil GCM ihn
 * zum Entschlüsseln braucht und er nicht geheim sein muss — geheim sein muss
 * nur, dass er sich nicht wiederholt, und dafür sorgt der Keystore selbst
 * (setRandomizedEncryptionRequired ist Vorgabe und bleibt an).
 */
class KeystoreTokenTresor : TokenVerschluesselung {

    private fun schluessel(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }

        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        gen.init(
            KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                // KEINE Nutzerauthentifizierung verlangt: Das Token wird auch
                // gebraucht, während der Bildschirm gesperrt ist (Hintergrund-
                // Abrufe). Eine Bindung an die Displaysperre würde die App bei
                // gesperrtem Gerät abmelden.
                .build()
        )
        return gen.generateKey()
    }

    override fun verschluessle(klartext: String): String {
        val c = Cipher.getInstance(TRANSFORMATION)
        c.init(Cipher.ENCRYPT_MODE, schluessel())
        val geheim = c.doFinal(klartext.toByteArray(Charsets.UTF_8))
        val zusammen = c.iv + geheim
        return Base64.encodeToString(zusammen, Base64.NO_WRAP)
    }

    override fun entschluessle(gespeichert: String): String? = try {
        val roh = Base64.decode(gespeichert, Base64.NO_WRAP)
        if (roh.size <= IV_LAENGE) null else {
            val c = Cipher.getInstance(TRANSFORMATION)
            c.init(
                Cipher.DECRYPT_MODE,
                schluessel(),
                GCMParameterSpec(GCM_TAG_BITS, roh, 0, IV_LAENGE),
            )
            String(c.doFinal(roh, IV_LAENGE, roh.size - IV_LAENGE), Charsets.UTF_8)
        }
    } catch (e: Exception) {
        // Absichtlich breit gefangen und still: Ein fehlender oder nicht mehr
        // passender Schlüssel, ein beschädigter Eintrag, ein Gerätewechsel —
        // für den Aufrufer ist all das dasselbe, nämlich "kein Token".
        null
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "brickinventory_auth_token"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_LAENGE = 12      // GCM-Standard
        const val GCM_TAG_BITS = 128
    }
}
