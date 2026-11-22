package ch.brickinventoryapp.data.di

import ch.brickinventoryapp.data.file.AppFileReader
import ch.brickinventoryapp.data.util.AppTextSource
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.util.TextSource
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/** The Android side of texts and files stays in core-data; the others see only the interfaces. */
@Module
@InstallIn(SingletonComponent::class)
internal abstract class FileModule {
    @Binds abstract fun fileReader(l: AppFileReader): FileReader
    @Binds abstract fun textSource(q: AppTextSource): TextSource
}
