package ch.brickinventoryapp.app.widget

import ch.brickinventoryapp.sicherheit.Geraetesperre
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Column
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import ch.brickinventoryapp.app.AppLockStore
import ch.brickinventoryapp.app.MainActivity
import ch.brickinventoryapp.ui.components.AppLock
import ch.brickinventoryapp.ressourcen.R
import androidx.hilt.work.HiltWorker
import ch.brickinventoryapp.data.Darstellungsablage
import ch.brickinventoryapp.data.Widgetablage
import ch.brickinventoryapp.data.Credentials
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.data.repository.FinancesRepository
import ch.brickinventoryapp.data.util.LanguageManager
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import java.util.concurrent.TimeUnit
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.ui.theme.Abstaende
/**
 * Die zuletzt geholten Zahlen. Das Widget liest nur hier und zeigt so auch ohne
 * Netz den letzten Stand; holen tut allein [WidgetArbeiter]. Verschlüsselt wie die
 * übrigen Ablagen; ein Klartext-Altbestand gilt als leer.
 */
internal object WidgetStore {
    /** Die frühere eigene Datei; nur noch zum Leeren, damit kein alter Stand liegen bleibt. */
    private const val OLD_FILE = "widget"

    private fun ablage(ctx: Context) = EntryPointAccessors.fromApplication(ctx, WidgetAccess::class.java).widgetablage()

    fun lies(ctx: Context): WidgetZahlen? = runCatching {
        ablage(ctx).widgetStatus()?.let { BrickJson.decodeFromString(WidgetZahlen.serializer(), it) }
    }.getOrNull()

    fun leeren(ctx: Context) {
        ablage(ctx).emptyWidgetStatus()
        ctx.deleteSharedPreferences(OLD_FILE)
    }

    fun schreibe(ctx: Context, z: WidgetZahlen) = ablage(ctx).setWidgetStatus(BrickJson.encodeToString(WidgetZahlen.serializer(), z))
}

/**
 * Was Glance-Widget und Ablage ausserhalb von Hilt brauchen. Ein Widget hat keinen
 * Konstruktor, den Hilt füllen könnte; dort ist der EntryPoint der vorgesehene Weg.
 */
@EntryPoint
@InstallIn(SingletonComponent::class)
interface WidgetAccess {
    fun credentials(): Credentials
    fun darstellung(): Darstellungsablage
    fun widgetablage(): Widgetablage
}

/**
 * Holt die Zahlen stündlich über die Repositories — mit deren Plattenspeicher
 * als Rückfall, wenn der Server schweigt.
 */
@HiltWorker
class WidgetArbeiter @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val finanzen: FinancesRepository,
    private val access: Credentials,
    private val lock: Geraetesperre,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): androidx.work.ListenableWorker.Result =
        if (fangeAusserAbbruch { refresh(applicationContext) }.getOrDefault(false)) androidx.work.ListenableWorker.Result.success()
        else androidx.work.ListenableWorker.Result.retry()

    /** false: später noch einmal. */
    private suspend fun refresh(ctx: Context): Boolean {
        // Abgemeldet gibt es nichts zu zeigen; der alte Stand bliebe sonst fremd sichtbar.
        if (access.tokenJetzt().isBlank()) {
            if (ohneToken(lock.gesperrt()) == WithoutToken.LATER) return false
            WidgetStore.leeren(ctx)
            SammlungsWidget().updateAll(ctx)
            return true
        }
        val pnl = (finanzen.getPnl() as? Ergebnis.Erfolg)?.data
        val verlauf = (finanzen.getPortfolioHistory("week") as? Ergebnis.Erfolg)?.data
        widgetNumbers(pnl, verlauf, System.currentTimeMillis())?.let { WidgetStore.schreibe(ctx, it) }
        SammlungsWidget().updateAll(ctx)
        return true
    }

    companion object {
        private const val NAME = "sammlungs-widget"

        fun einplanen(ctx: Context) = runCatching {
            val job = PeriodicWorkRequestBuilder<WidgetArbeiter>(1, TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, job)
        }

        fun unsubscribe(ctx: Context) = runCatching { WorkManager.getInstance(ctx).cancelUniqueWork(NAME) }
    }
}

/** Sammlungswert, G&V heute und gesamt; ein Tipp öffnet die App. */
class SammlungsWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val access = runCatching { EntryPointAccessors.fromApplication(context, WidgetAccess::class.java) }.getOrNull()
        val angemeldet = fangeAusserAbbruch { access?.credentials()?.tokenJetzt()?.isNotBlank() == true }.getOrDefault(false)
        // Geldwerte nur, wenn der Nutzer sie auf dem Startbildschirm erlaubt und die App-Sperre nicht greift.
        val zeigen = access?.darstellung()?.showWidgetValues() == true &&
            !AppLock.hiddenWidget(AppLockStore(context))
        val zahlen = widgetDisplay(WidgetStore.lies(context), angemeldet)
        // Die Texte in der Sprache der App, nicht des Systems (LanguageManager).
        val ctx = LanguageManager.localizedContext(context)
        val titel = ctx.getString(R.string.widget_titel)
        val zeilen = zahlen?.let {
            val (wert, heute, gesamt) = widgetValues(it, zeigen)
            listOf(
                ctx.getString(R.string.widget_wert) to wert,
                ctx.getString(R.string.widget_heute) to heute,
                ctx.getString(R.string.widget_gesamt) to gesamt,
            )
        }
        val leer = ctx.getString(R.string.widget_leer)
        provideContent { GlanceTheme { Inhalt(titel, zeilen, leer) } }
    }

    @Composable
    private fun Inhalt(titel: String, zeilen: List<Pair<String, String>>?, leer: String) {
        Column(
            GlanceModifier.fillMaxSize().background(GlanceTheme.colors.widgetBackground)
                .cornerRadius(16.dp).padding(Abstaende.mittel).clickable(actionStartActivity<MainActivity>()),
        ) {
            Text(titel, style = TextStyle(fontWeight = FontWeight.Bold, fontSize = 14.sp, color = GlanceTheme.colors.onSurface))
            Spacer(GlanceModifier.height(6.dp))
            if (zeilen == null) {
                Text(leer, style = TextStyle(fontSize = 12.sp, color = GlanceTheme.colors.onSurfaceVariant))
            } else for ((name, wert) in zeilen) {
                Text(name, style = TextStyle(fontSize = 12.sp, color = GlanceTheme.colors.onSurfaceVariant))
                Text(wert, style = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.Medium, color = GlanceTheme.colors.onSurface))
            }
        }
    }
}

/** Meldet das Widget an Android; mit dem ersten Widget beginnt die Aktualisierung. */
class SammlungsWidgetEmpfaenger : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = SammlungsWidget()

    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        WidgetArbeiter.einplanen(context)
    }

    override fun onDisabled(context: Context) {
        super.onDisabled(context)
        WidgetArbeiter.unsubscribe(context)
    }
}
