package ch.brickinventoryapp.app

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import ch.brickinventoryapp.services.alarm.PreisalarmWorker
import ch.brickinventoryapp.state.ui.Meldungseingang
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/**
 * The only way a notification opens a set. Not exported: only
 * the own PendingIntent reaches it, a foreign app gets a
 * SecurityException. It stores the target in the process and starts the app without
 * extras; the exported MainActivity reads none.
 */
@AndroidEntryPoint
class MeldungsEinstieg : ComponentActivity() {
    @Inject lateinit var inbox: Meldungseingang

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        startActivity(forwardMessage(this, intent, inbox))
        finish()
    }
}

/**
 * Store and build the app's start. NEW_TASK with CLEAR_TOP|SINGLE_TOP: the
 * entry has no task affinity, the running app thus gets onNewIntent()
 * in its own task instead of a second instance.
 */
internal fun forwardMessage(ctx: Context, arrival: Intent?, inbox: Meldungseingang): Intent {
    inbox.ablegen(arrival?.getStringExtra(PreisalarmWorker.EXTRA_SET))
    return Intent(ctx, MainActivity::class.java).addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
}
