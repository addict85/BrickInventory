package ch.brickinventoryapp.widget

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
import ch.brickinventoryapp.MainActivity
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.PreferencesManager
import ch.brickinventoryapp.data.api.ApiJson
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.util.LanguageManager
import ch.brickinventoryapp.util.fmtMoney
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import java.util.concurrent.TimeUnit

/**
 * Die zuletzt geholten Zahlen. Das Widget liest nur hier und zeigt so auch ohne
 * Netz den letzten Stand; holen tut allein [WidgetArbeiter].
 */
internal object WidgetAblage {
    private const val DATEI = "widget"
    private const val SCHLUESSEL = "zahlen"

    fun lies(ctx: Context): WidgetZahlen? = runCatching {
        ctx.getSharedPreferences(DATEI, Context.MODE_PRIVATE).getString(SCHLUESSEL, null)
            ?.let { ApiJson.decodeFromString(WidgetZahlen.serializer(), it) }
    }.getOrNull()

    fun leeren(ctx: Context) {
        ctx.getSharedPreferences(DATEI, Context.MODE_PRIVATE).edit().remove(SCHLUESSEL).apply()
    }

    fun schreibe(ctx: Context, z: WidgetZahlen) {
        ctx.getSharedPreferences(DATEI, Context.MODE_PRIVATE).edit()
            .putString(SCHLUESSEL, ApiJson.encodeToString(WidgetZahlen.serializer(), z)).apply()
    }
}

/**
 * Holt die Zahlen stündlich über die Repositories — mit deren Plattenspeicher
 * als Rückfall, wenn der Server schweigt. EntryPoint statt @HiltWorker wie beim
 * Preisalarm: weniger Apparat für einen Arbeiter.
 */
class WidgetArbeiter(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    @EntryPoint
    @InstallIn(SingletonComponent::class)
    interface Zugang {
        fun finanzen(): FinanzenRepository
        fun prefs(): PreferencesManager
    }

    override suspend fun doWork(): androidx.work.ListenableWorker.Result =
        runCatching { aktualisiere(applicationContext) }.fold(
            { androidx.work.ListenableWorker.Result.success() },
            { androidx.work.ListenableWorker.Result.retry() },
        )

    companion object {
        private const val NAME = "sammlungs-widget"

        suspend fun aktualisiere(ctx: Context) {
            val zugang = EntryPointAccessors.fromApplication(ctx, Zugang::class.java)
            // Abgemeldet gibt es nichts zu zeigen; der alte Stand bliebe sonst fremd sichtbar.
            if (zugang.prefs().tokenJetzt().isBlank()) return
            val pnl = (zugang.finanzen().getPnl() as? ch.brickinventoryapp.data.repository.Result.Success)?.data
            val verlauf = (zugang.finanzen().getPortfolioHistory("week") as? ch.brickinventoryapp.data.repository.Result.Success)?.data
            widgetZahlen(pnl, verlauf, System.currentTimeMillis())?.let { WidgetAblage.schreibe(ctx, it) }
            SammlungsWidget().updateAll(ctx)
        }

        fun einplanen(ctx: Context) = runCatching {
            val auftrag = PeriodicWorkRequestBuilder<WidgetArbeiter>(1, TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, auftrag)
        }

        fun abbestellen(ctx: Context) = runCatching { WorkManager.getInstance(ctx).cancelUniqueWork(NAME) }
    }
}

/** Sammlungswert, G&V heute und gesamt; ein Tipp öffnet die App. */
class SammlungsWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val zahlen = WidgetAblage.lies(context)
        // Die Texte in der Sprache der App, nicht des Systems (LanguageManager).
        val ctx = LanguageManager.localizedContext(context)
        val titel = ctx.getString(R.string.widget_titel)
        val zeilen = zahlen?.let {
            listOf(
                ctx.getString(R.string.widget_wert) to (it.wert?.let { w -> fmtMoney(w, it.waehrung) } ?: "—"),
                ctx.getString(R.string.widget_heute) to gvText(it.heute, it.heuteProzent, it.waehrung),
                ctx.getString(R.string.widget_gesamt) to gvText(it.gesamt, it.gesamtProzent, it.waehrung),
            )
        }
        val leer = ctx.getString(R.string.widget_leer)
        provideContent { GlanceTheme { Inhalt(titel, zeilen, leer) } }
    }

    @Composable
    private fun Inhalt(titel: String, zeilen: List<Pair<String, String>>?, leer: String) {
        Column(
            GlanceModifier.fillMaxSize().background(GlanceTheme.colors.widgetBackground)
                .cornerRadius(16.dp).padding(12.dp).clickable(actionStartActivity<MainActivity>()),
        ) {
            Text(titel, style = TextStyle(fontWeight = FontWeight.Bold, fontSize = 14.sp, color = GlanceTheme.colors.onSurface))
            Spacer(GlanceModifier.height(6.dp))
            if (zeilen == null) {
                Text(leer, style = TextStyle(fontSize = 12.sp, color = GlanceTheme.colors.onSurfaceVariant))
            } else for ((name, wert) in zeilen) {
                Text(name, style = TextStyle(fontSize = 11.sp, color = GlanceTheme.colors.onSurfaceVariant))
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
        WidgetArbeiter.abbestellen(context)
    }
}
