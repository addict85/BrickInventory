package ch.brickinventoryapp

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import ch.brickinventoryapp.alarm.PreisalarmWorker
import ch.brickinventoryapp.ui.Meldungseingang
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/**
 * Der einzige Weg, auf dem eine Meldung ein Set öffnet. Nicht exportiert: Nur
 * die eigene PendingIntent erreicht ihn, eine fremde App bekommt eine
 * SecurityException. Er legt das Ziel im Prozess ab und startet die App ohne
 * Extras; die exportierte MainActivity liest keine.
 */
@AndroidEntryPoint
class MeldungsEinstieg : ComponentActivity() {
    @Inject lateinit var eingang: Meldungseingang

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        startActivity(meldungWeiterreichen(this, intent, eingang))
        finish()
    }
}

/**
 * Ablegen und den Start der App bauen. NEW_TASK mit CLEAR_TOP|SINGLE_TOP: Der
 * Einstieg hat keine Task-Affinität, die laufende App erhält so onNewIntent()
 * in ihrer eigenen Task statt einer zweiten Instanz.
 */
internal fun meldungWeiterreichen(ctx: Context, ankunft: Intent?, eingang: Meldungseingang): Intent {
    eingang.ablegen(ankunft?.getStringExtra(PreisalarmWorker.EXTRA_SET))
    return Intent(ctx, MainActivity::class.java).addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
}
