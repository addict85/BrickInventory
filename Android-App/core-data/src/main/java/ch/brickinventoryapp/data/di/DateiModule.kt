package ch.brickinventoryapp.data.di

import ch.brickinventoryapp.data.datei.AppDateiLeser
import ch.brickinventoryapp.data.util.AppTextquelle
import ch.brickinventoryapp.model.datei.DateiLeser
import ch.brickinventoryapp.model.util.Textquelle
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/** Die Android-Seite von Texten und Dateien bleibt in core-data; die anderen sehen nur die Schnittstellen. */
@Module
@InstallIn(SingletonComponent::class)
internal abstract class DateiModule {
    @Binds abstract fun dateiLeser(l: AppDateiLeser): DateiLeser
    @Binds abstract fun textquelle(q: AppTextquelle): Textquelle
}
