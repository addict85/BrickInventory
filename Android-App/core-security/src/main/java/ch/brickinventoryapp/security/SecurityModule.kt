package ch.brickinventoryapp.security

import android.app.KeyguardManager
import android.content.Context
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import java.io.File
import javax.inject.Singleton

/** The app's vaults and keys; the Keystore implementations stay in this module. */
@Module
@InstallIn(SingletonComponent::class)
internal object SecurityModule {

    /**
     * Provide token encryption as an interface, not as a concrete
     * class: the implementation needs the Android Keystore and only runs on a
     * device. Bound tightly to it, the takeover logic of
     * TokenAblage could not be tested on the JVM.
     */
    @Provides
    @Singleton
    fun provideTokenEncryption(): TokenEncryption =
        EntsperrVault(
            KeystoreTokenVault(KeystoreTokenVault.ALIAS_UNLOCKED, onlyUnlocked = true),
            KeystoreTokenVault(readOnly = true),
        )

    /** Locked here means: the token's key is currently releasing nothing (EntsperrVault). */
    @Provides
    @Singleton
    fun provideGeraetesperre(@ApplicationContext context: Context): Geraetesperre {
        val guard = context.getSystemService(KeyguardManager::class.java)
        return Geraetesperre { guard?.isDeviceLocked == true }
    }

    /**
     * The key of the local stores (inventory, purchase prices, outbox); wrapped like the token
     * under an alias that only works unlocked. The outbox doesn't need its own: sending
     * only happens with the token anyway, and that too only opens unlocked.
     */
    @Provides
    @Singleton
    fun provideAblageschluessel(@ApplicationContext context: Context, lockWipe: LockWipe): Ablageschluessel =
        Ablageschluessel(
            File(context.noBackupFilesDir, "ablage.schluessel"),
            EntsperrVault(
                KeystoreTokenVault(ALIAS_STORE_UNLOCKED, onlyUnlocked = true),
                KeystoreTokenVault(ALIAS_STORE, readOnly = true),
            ),
        ).also { lockWipe.register(it::forgetInMemory) }

    /**
     * Two keys that survive sign-out. The one for pins and the user-CA switch works
     * even locked: every TLS connection asks it, including one from a background revocation.
     * Address, name, widget and orders sit under the second one, which only works unlocked;
     * only whoever opens the token needs it, and that too only opens unlocked.
     */
    @Provides
    @Singleton
    fun provideVertrauenschiffre(@ApplicationContext context: Context, lockWipe: LockWipe): Vertrauenschiffre {
        val schluessel = Ablageschluessel(
            File(context.noBackupFilesDir, "vertrauen.schluessel"), KeystoreTokenVault("brickinventory_vertrauen"),
        )
        val angaben = Ablageschluessel(
            File(context.noBackupFilesDir, "angaben.schluessel"),
            KeystoreTokenVault(ALIAS_DETAILS, onlyUnlocked = true),
        )
        // The pins' key stays: TLS needs it locked too, and it reveals no account.
        lockWipe.register(angaben::forgetInMemory)
        return Vertrauenschiffre(angaben = { angaben.fuer("angaben") }) { schluessel.fuer("vertrauen") }
    }

    @Provides
    fun certificateQuestion(z: CertificatePrompt): CertificateQuestion = z

    private const val ALIAS_STORE = "brickinventory_ablage"
    private const val ALIAS_DETAILS = "brickinventory_angaben_entsperrt"
    /** Its own alias: an existing key does not take on the condition retroactively. */
    private const val ALIAS_STORE_UNLOCKED = "brickinventory_ablage_entsperrt"
}
