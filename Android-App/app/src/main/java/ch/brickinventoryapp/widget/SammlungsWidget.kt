package ch.brickinventoryapp.widget

import android.content.Context
import android.util.Base64
import androidx.core.content.edit
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
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.PreferencesManager
import ch.brickinventoryapp.data.api.ApiJson
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.util.AblageChiffre
import ch.brickinventoryapp.util.Ablageschluessel
import ch.brickinventoryapp.util.LanguageManager
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import java.util.concurrent.TimeUnit

/**
 * Die zuletzt geholten Zahlen. Das Widget liest nur hier und zeigt so auch ohne
 * Netz den letzten Stand; holen tut allein [WidgetArbeiter]. Verschlüsselt wie die
 * übrigen Ablagen (sec8 N5); ein Klartext-Altbestand gilt als leer.
 */
internal object WidgetAblage {
    private const val DATEI = "widget"
    private const val SCHLUESSEL = "zahlen"

    private fun chiffre(ctx: Context) = AblageChiffre {
        EntryPointAccessors.fromApplication(ctx, WidgetArbeiter.Zugang::class.java).ablage().fuer("widget")
    }

    /** Zweck und Schlüssel als AAD (sec10 H7), wie im Antwort-Cache. */
    private const val BINDUNG = "$DATEI/$SCHLUESSEL"

    fun lies(ctx: Context): WidgetZahlen? {
        val roh = ctx.getSharedPreferences(DATEI, Context.MODE_PRIVATE).getString(SCHLUESSEL, null) ?: return null
        return runCatching {
            val daten = Base64.decode(roh, Base64.NO_WRAP)
            val verfahren = chiffre(ctx)
            // Ein Stand ohne Bindung (vor sec10 H7) wird einmal übernommen und gebunden neu abgelegt.
            val text = verfahren.entschluessle(daten, BINDUNG)
                ?: verfahren.entschluessleUngebunden(daten)?.also { ablegen(ctx, verfahren, it) }
            text?.let { ApiJson.decodeFromString(WidgetZahlen.serializer(), it.toString(Charsets.UTF_8)) }
        }.getOrNull()
    }

    fun leeren(ctx: Context) {
        ctx.getSharedPreferences(DATEI, Context.MODE_PRIVATE).edit { remove(SCHLUESSEL) }
    }

    fun schreibe(ctx: Context, z: WidgetZahlen) =
        ablegen(ctx, chiffre(ctx), ApiJson.encodeToString(WidgetZahlen.serializer(), z).toByteArray(Charsets.UTF_8))

    private fun ablegen(ctx: Context, verfahren: AblageChiffre, text: ByteArray) {
        ctx.getSharedPreferences(DATEI, Context.MODE_PRIVATE).edit {
            putString(SCHLUESSEL, Base64.encodeToString(verfahren.verschluessle(text, BINDUNG), Base64.NO_WRAP))
        }
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
        fun ablage(): Ablageschluessel
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
            if (zugang.prefs().tokenJetzt().isBlank()) {
                WidgetAblage.leeren(ctx)
                SammlungsWidget().updateAll(ctx)
                return
            }
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
        val prefs = runCatching { EntryPointAccessors.fromApplication(context, WidgetArbeiter.Zugang::class.java).prefs() }.getOrNull()
        val angemeldet = runCatching { prefs?.tokenJetzt()?.isNotBlank() == true }.getOrDefault(false)
        // Geldwerte nur, wenn der Nutzer sie auf dem Startbildschirm erlaubt (sec8 H5).
        val zeigen = prefs?.widgetWerteZeigen() == true
        val zahlen = widgetAnzeige(WidgetAblage.lies(context), angemeldet)
        // Die Texte in der Sprache der App, nicht des Systems (LanguageManager).
        val ctx = LanguageManager.localizedContext(context)
        val titel = ctx.getString(R.string.widget_titel)
        val zeilen = zahlen?.let {
            val (wert, heute, gesamt) = widgetWerte(it, zeigen)
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
