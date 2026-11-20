package ch.brickinventoryapp.sicherheit

import android.app.KeyguardManager
import android.content.Context
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import java.io.File
import javax.inject.Singleton

/** Die Tresore und Schlüssel der App; die Keystore-Umsetzungen bleiben in diesem Modul. */
@Module
@InstallIn(SingletonComponent::class)
internal object SecurityModule {

    /**
     * Die Token-Verschlüsselung als Schnittstelle bereitstellen, nicht als konkrete
     * Klasse: Die Umsetzung braucht den Android-Keystore und läuft nur auf einem
     * Gerät. Fest daran gebunden liesse sich die Übernahme-Logik der
     * TokenAblage nicht auf der JVM prüfen.
     */
    @Provides
    @Singleton
    fun provideTokenEncryption(): TokenEncryption =
        EntsperrVault(
            KeystoreTokenVault(KeystoreTokenVault.ALIAS_UNLOCKED, onlyUnlocked = true),
            KeystoreTokenVault(readOnly = true),
        )

    /** Gesperrt heisst hier: Der Schlüssel des Tokens gibt gerade nichts frei (EntsperrVault). */
    @Provides
    @Singleton
    fun provideGeraetesperre(@ApplicationContext context: Context): Geraetesperre {
        val guard = context.getSystemService(KeyguardManager::class.java)
        return Geraetesperre { guard?.isDeviceLocked == true }
    }

    /**
     * Der Schlüssel der lokalen Ablagen (Bestand, Kaufpreise, Ausgang); umhüllt wie das Token
     * unter einem Alias, der nur entsperrt arbeitet. Der Ausgang braucht keinen eigenen: Senden
     * geht ohnehin erst mit dem Token, und das öffnet sich auch nur entsperrt.
     */
    @Provides
    @Singleton
    fun provideAblageschluessel(@ApplicationContext context: Context): Ablageschluessel =
        Ablageschluessel(
            File(context.noBackupFilesDir, "ablage.schluessel"),
            EntsperrVault(
                KeystoreTokenVault(ALIAS_STORE_UNLOCKED, onlyUnlocked = true),
                KeystoreTokenVault(ALIAS_STORE, readOnly = true),
            ),
        )

    /**
     * Zwei Schlüssel, die das Abmelden überleben. Der für Pins und Nutzer-CA-Schalter arbeitet
     * auch gesperrt: Jede TLS-Verbindung fragt ihn, auch die einer Entwertung im Hintergrund.
     * Adresse, Name, Widget und Aufträge liegen unter dem zweiten, der nur entsperrt arbeitet;
     * sie braucht erst, wer das Token öffnet, und das geht ohnehin nur entsperrt.
     */
    @Provides
    @Singleton
    fun provideVertrauenschiffre(@ApplicationContext context: Context): Vertrauenschiffre {
        val schluessel = Ablageschluessel(
            File(context.noBackupFilesDir, "vertrauen.schluessel"), KeystoreTokenVault("brickinventory_vertrauen"),
        )
        val angaben = Ablageschluessel(
            File(context.noBackupFilesDir, "angaben.schluessel"),
            KeystoreTokenVault(ALIAS_DETAILS, onlyUnlocked = true),
        )
        return Vertrauenschiffre(angaben = { angaben.fuer("angaben") }) { schluessel.fuer("vertrauen") }
    }

    @Provides
    fun certificateQuestion(z: CertificatePrompt): CertificateQuestion = z

    private const val ALIAS_STORE = "brickinventory_ablage"
    private const val ALIAS_DETAILS = "brickinventory_angaben_entsperrt"
    /** Eigener Alias: Ein bestehender Schlüssel nimmt die Bedingung nachträglich nicht an. */
    private const val ALIAS_STORE_UNLOCKED = "brickinventory_ablage_entsperrt"
}
