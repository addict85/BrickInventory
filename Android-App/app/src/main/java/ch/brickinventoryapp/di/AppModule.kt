package ch.brickinventoryapp.di

import android.content.Context
import androidx.glance.appwidget.updateAll
import ch.brickinventoryapp.BuildConfig
import ch.brickinventoryapp.MeldungsEinstieg
import ch.brickinventoryapp.util.AppFassung
import ch.brickinventoryapp.data.Startziel
import ch.brickinventoryapp.ui.Abmeldehaken
import ch.brickinventoryapp.widget.SammlungsWidget
import ch.brickinventoryapp.widget.WidgetAblage
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent

/**
 * Was nur die App kennt: ihre Activity und ihr Widget. Die Module darunter sehen
 * davon nur die Schnittstellen, sonst hinge die Datenschicht an der App.
 */
@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    /**
     * Der nicht exportierte Einstieg, nicht MainActivity: Nur er nimmt ein Ziel an.
     * Die Klasse selbst, nicht ihr Name: Für R8 ist nur ein Klassenverweis ein Aufruf.
     */
    @Provides
    fun provideStartziel(): Startziel = Startziel(MeldungsEinstieg::class.java)

    @Provides
    fun provideAppFassung(): AppFassung = AppFassung(BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE)

    /** Das Widget zeigt nach dem Abmelden sonst die Zahlen des alten Kontos. */
    @Provides
    fun provideWidgetanstoss(@ApplicationContext ctx: Context): ch.brickinventoryapp.ui.Widgetanstoss =
        ch.brickinventoryapp.ui.Widgetanstoss { SammlungsWidget().updateAll(ctx) }

    @Provides
    fun provideAbmeldehaken(@ApplicationContext ctx: Context): Abmeldehaken = Abmeldehaken {
        WidgetAblage.leeren(ctx)
        SammlungsWidget().updateAll(ctx)
    }
}
