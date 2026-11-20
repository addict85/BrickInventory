package ch.brickinventoryapp.data.di

import ch.brickinventoryapp.data.datei.AppFileReader
import ch.brickinventoryapp.data.util.AppTextSource
import ch.brickinventoryapp.model.datei.FileReader
import ch.brickinventoryapp.model.util.Textquelle
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/** Die Android-Seite von Texten und Dateien bleibt in core-data; die anderen sehen nur die Schnittstellen. */
@Module
@InstallIn(SingletonComponent::class)
internal abstract class FileModule {
    @Binds abstract fun fileReader(l: AppFileReader): FileReader
    @Binds abstract fun textSource(q: AppTextSource): Textquelle
}
