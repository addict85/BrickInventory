package ch.brickinventoryapp.ui.components

import android.app.KeyguardManager
import android.os.SystemClock
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.res.stringResource
import androidx.core.content.ContextCompat
import androidx.core.content.getSystemService
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.lifecycleScope
import ch.brickinventoryapp.model.schritt.Schrittaktion
import ch.brickinventoryapp.model.schritt.Schrittbindung
import ch.brickinventoryapp.ressourcen.R
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import java.security.Signature
import kotlin.coroutines.resume

/**
 * Vor einem heiklen Schritt (Gutschein-PIN, Wiederherstellungscodes, Verwaltung)
 * die Gerätesperre fragen: Wer das entsperrte Telefon kurz in der Hand hat, soll
 * dort nicht weiterkommen. [weiter] läuft nur nach Bestätigung.
 */
fun interface Schrittschutz {
    fun bestaetige(grund: String, weiter: () -> Unit)

    /** Für einen Schritt, den der Server prüft: Die Bestätigung gilt dort nur für [aktion]. */
    fun bestaetige(grund: String, aktion: Schrittaktion, weiter: () -> Unit) = bestaetige(grund, weiter)
}

/** Derselbe Schutz, immer für [aktion]: So bleiben Aufrufe mit zwei Argumenten an den Server gebunden. */
fun Schrittschutz.fuer(aktion: Schrittaktion): Schrittschutz {
    val basis = this
    return Schrittschutz { grund, weiter -> basis.bestaetige(grund, aktion, weiter) }
}

/**
 * Ohne Anbieter geschieht nichts: Vergässe eine Activity ihn, wäre der Schutz
 * sonst still aus. MainActivity setzt [GeraeteSchrittschutz], Tests ihren eigenen.
 */
val LocalSchrittschutz = staticCompositionLocalOf { Schrittschutz { _, _ -> } }

/**
 * Fingerabdruck (starke Biometrie), sonst PIN, Muster oder Passwort des Geräts. Ohne
 * Sperre gibt es nichts zu prüfen; dann warnt [ohneSperre], statt still durchzulassen.
 * Bestätigt ist erst, was der Keystore freigibt und, für eine [Schrittaktion] mit
 * Kennung, der Server mit der Signatur über seine Challenge annimmt ([Schrittablauf]).
 */
// [untertitel] und [keinSchluessel] kommen von aussen: Unter Android 13 trägt die
// Activity die System- statt der App-Sprache, den lokalisierten Context kennt core-ui nicht.
class GeraeteSchrittschutz(
    private val activity: FragmentActivity,
    private val keinSchluessel: () -> Unit = {},
    private val bindung: Schrittbindung = Schrittbindung.OHNE,
    /** Der Server lehnte ab; null: keine Antwort. */
    private val abgelehnt: (meldung: String?) -> Unit = {},
    /** Das Gerät kann keinen Schlüssel mit Attestation erzeugen; heikle Schritte gehen dann nur in der Webapp. */
    private val ohneAttestation: () -> Unit = {},
    private val untertitel: () -> String,
) : Schrittschutz {
    // Je Aktion: Die Freigabe am Server gilt auch nur für eine.
    private val fristen = mutableMapOf<Schrittaktion, Bestaetigungsfrist>()
    private val ablauf = Schrittablauf(bindung, Schrittfreigabe(GeraeteSchluessel::oeffentlich))

    /** Die Rückfrage ohne Displaysperre; MainActivity zeigt sie mit [OhneSperreWarnung]. */
    val ohneSperre = OhneSperre()

    /** Beim Verlassen der App (MainActivity.onStop): Danach wird wieder gefragt. */
    fun vergiss() = fristen.values.forEach(Bestaetigungsfrist::vergiss)

    /** Nach der Anmeldung: Nur dann nimmt der Server den Schlüssel an ([Schluesselbindung]). */
    fun bindeAnServer() {
        if (activity.getSystemService<KeyguardManager>()?.isDeviceSecure != true) return
        activity.lifecycleScope.launch {
            when (val a = Schluesselbindung(bindung, GeraeteSchluessel).binde()) {
                Schluesselbindung.Ausgang.Gebunden -> Unit
                Schluesselbindung.Ausgang.OhneAttestation -> ohneAttestation()
                is Schluesselbindung.Ausgang.Abgelehnt -> a.meldung?.let(abgelehnt)
            }
        }
    }

    override fun bestaetige(grund: String, weiter: () -> Unit) = bestaetige(grund, Schrittaktion.LOKAL, weiter)

    override fun bestaetige(grund: String, aktion: Schrittaktion, weiter: () -> Unit) {
        val frist = fristen.getOrPut(aktion) { Bestaetigungsfrist(uhr = SystemClock::elapsedRealtime) }
        if (frist.gilt()) {
            weiter()
            return
        }
        if (activity.getSystemService<KeyguardManager>()?.isDeviceSecure != true) {
            ohneSperre.frage(grund) { frist.bestaetigt(); weiter() }
            return
        }
        // Ohne gebundenen Schlüssel kein Weiter: Ein Rückfall auf die blosse Rückfrage
        // wäre genau der Weg, den ein eingehakter Rückruf öffnet.
        val signatur = runCatching { GeraeteSchluessel.signatur() }.getOrNull() ?: return keinSchluessel()
        activity.lifecycleScope.launch {
            when (val a = ablauf.bestaetige(aktion) { entsperre(grund, signatur) }) {
                Schrittablauf.Ausgang.Weiter -> { frist.bestaetigt(); weiter() }
                Schrittablauf.Ausgang.Abgebrochen -> Unit
                is Schrittablauf.Ausgang.Abgelehnt -> abgelehnt(a.meldung)
            }
        }
    }

    /** Die vom Keystore freigegebene Signatur; null bei Abbruch oder Fehler der Sperre. */
    private suspend fun entsperre(grund: String, signatur: Signature): Signature? = suspendCancellableCoroutine { weiter ->
        val rueckruf = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                if (weiter.isActive) weiter.resume(result.cryptoObject?.signature)
            }
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                if (weiter.isActive) weiter.resume(null)
            }
        }
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(grund)
            .setSubtitle(untertitel())
            // Seit minSdk 30 immer starke Biometrie oder die Gerätesperre, nie Klasse-2-Gesicht;
            // beides kann der Keystore-Schlüssel freigeben (GeraeteSchluessel).
            .setAllowedAuthenticators(BIOMETRIC_STRONG or DEVICE_CREDENTIAL)
            .build()
        BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), rueckruf)
            .authenticate(info, BiometricPrompt.CryptoObject(signatur))
    }
}

/**
 * Ein Schritt, der ohne Displaysperre wartet: Wer ein Gerät ohne Sperre
 * benutzt, soll wissen, dass PIN, Codes und Verwaltung dort jedem offenstehen, der
 * das Telefon kurz hat. Ein Ja gilt wie eine Bestätigung bis zur Frist.
 */
class OhneSperre {
    class Wartend(val grund: String, val weiter: () -> Unit)

    var wartet by mutableStateOf<Wartend?>(null)
        private set

    fun frage(grund: String, weiter: () -> Unit) {
        wartet = Wartend(grund, weiter)
    }

    fun fortfahren() {
        val w = wartet ?: return
        wartet = null
        w.weiter()
    }

    fun abbrechen() {
        wartet = null
    }
}

/** Die Rückfrage zu [OhneSperre]; Wegtippen bricht ab, ein überlagerter Tipp zählt nicht. */
@Composable
fun OhneSperreWarnung(ohneSperre: OhneSperre) {
    val w = ohneSperre.wartet ?: return
    val titel = stringResource(R.string.schritt_ohne_sperre_titel)
    AlertDialog(
        onDismissRequest = ohneSperre::abbrechen,
        modifier = Modifier.semantics { paneTitle = titel },
        title = { Text(titel, Modifier.semantics { heading() }) },
        text = {
            Ueberdeckungsschutz()
            Text(stringResource(R.string.schritt_ohne_sperre_text, w.grund))
        },
        confirmButton = {
            TextButton(onClick = ohneSperre::fortfahren) { Text(stringResource(R.string.schritt_ohne_sperre_weiter)) }
        },
        dismissButton = {
            TextButton(onClick = ohneSperre::abbrechen) { Text(stringResource(R.string.common_cancel)) }
        },
    )
}

/**
 * Zeigt [inhalt] erst nach der Bestätigung und fragt beim Öffnen von selbst.
 * Verlässt die App den Vordergrund, ist der Bereich wieder gesperrt.
 */
@Composable
fun Schrittsperre(grund: String, aktion: Schrittaktion = Schrittaktion.LOKAL, inhalt: @Composable () -> Unit) {
    // Eine Seite hinter der Gerätesperre ist heikel: kein untergeschobener Tipp.
    Ueberdeckungsschutz()
    val basis = LocalSchrittschutz.current
    val schutz = remember(basis, aktion) { basis.fuer(aktion) }
    var entsperrt by remember { mutableStateOf(false) }
    val frage = { schutz.bestaetige(grund) { entsperrt = true } }
    LaunchedEffect(schutz) { if (!entsperrt) frage() }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { entsperrt = false }
    if (entsperrt) {
        inhalt()
    } else {
        Box(Modifier.fillMaxSize(), Alignment.Center) {
            Button(onClick = frage) { Text(stringResource(R.string.schritt_entsperren)) }
        }
    }
}
