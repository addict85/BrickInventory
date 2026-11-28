package ch.brickinventoryapp.data.util

import android.content.Context
import ch.brickinventoryapp.dataapi.language.AppLanguage
import ch.brickinventoryapp.model.util.TextSource
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject

/** Via AppLanguage, not the context directly: the app can have a different language than the system. */
internal class AppTextSource @Inject constructor(
    @param:ApplicationContext private val ctx: Context,
    private val appLanguage: AppLanguage,
) : TextSource {
    override fun text(id: Int, vararg args: Any?): String {
        val c = appLanguage.localizedContext(ctx)
        return if (args.isEmpty()) c.getString(id) else c.getString(id, *args)
    }

    override fun quantity(id: Int, count: Int, vararg args: Any?): String =
        appLanguage.localizedContext(ctx).resources.getQuantityString(id, count, *args)
}
