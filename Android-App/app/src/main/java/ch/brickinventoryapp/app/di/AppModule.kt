package ch.brickinventoryapp.app.di

import android.content.Context
import androidx.glance.appwidget.updateAll
import ch.brickinventoryapp.BuildConfig
import ch.brickinventoryapp.app.MeldungsEinstieg
import ch.brickinventoryapp.model.util.AppVersion
import ch.brickinventoryapp.data.Startziel
import ch.brickinventoryapp.state.ui.Abmeldehaken
import ch.brickinventoryapp.app.widget.SammlungsWidget
import ch.brickinventoryapp.app.widget.WidgetStore
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import ch.brickinventoryapp.state.ui.Widgetanstoss

/**
 * What only the app knows: its activity and its widget. The modules below see
 * only the interfaces of it, otherwise the data layer would depend on the app.
 */
@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    /**
     * The non-exported entry, not MainActivity: only it accepts a target.
     * The class itself, not its name: for R8 only a class reference is a call.
     */
    @Provides
    fun provideStartziel(): Startziel = Startziel(MeldungsEinstieg::class.java)

    @Provides
    fun provideAppVersion(): AppVersion = AppVersion(BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE)

    /** Otherwise after sign-out the widget shows the numbers of the old account. */
    @Provides
    fun provideWidgetanstoss(@ApplicationContext ctx: Context): Widgetanstoss =
        Widgetanstoss { SammlungsWidget().updateAll(ctx) }

    @Provides
    fun provideAbmeldehaken(@ApplicationContext ctx: Context): Abmeldehaken = Abmeldehaken {
        WidgetStore.leeren(ctx)
        SammlungsWidget().updateAll(ctx)
    }
}
