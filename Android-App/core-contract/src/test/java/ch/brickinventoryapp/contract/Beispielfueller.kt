package ch.brickinventoryapp.contract

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.Herkunft
import ch.brickinventoryapp.model.util.zeitpunkt
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import java.lang.reflect.Method
import java.lang.reflect.Modifier
import java.lang.reflect.ParameterizedType
import java.lang.reflect.Type
import java.lang.reflect.WildcardType
import java.time.Instant

/**
 * Builds server models in which every field has its own value, and
 * compares them with their view — via Java reflection, so that every new
 * mapping in contract/abbildung is checked along without its own test.
 */
object Beispielfueller {
    private var counter = 0

    /**
     * The files in contract/abbildung, named by name: under Gradle
     * the main classes lie in a jar, a folder walk found nothing there.
     * That the list is complete is checked by UiModelFigureTest on the source.
     */
    val ABBILDUNGSDATEIEN = listOf(
        "EinzelAbbildungen", "FinanzAbbildungen", "GutscheinKlartextAbbildung", "HaushaltAbbildungen", "HintergrundAbbildungen",
        "KatalogAbbildungen", "KontoAbbildungen", "PreisAbbildungen", "SetAbbildungen", "TeileAbbildungen", "VerwaltungAbbildungen",
    )

    /** All `alsAnsicht(<vertrag.X>)` of the files in [ABBILDUNGSDATEIEN]. */
    fun figures(): List<Method> {
        return ABBILDUNGSDATEIEN.map { Class.forName("ch.brickinventoryapp.contract.mapping.${it}Kt") }
            .flatMap { k -> k.methods.filter { it.name == "alsAnsicht" && it.parameterCount == 1 } }
            .filter { it.parameterTypes[0].name.startsWith("ch.brickinventoryapp.contract.") && !it.parameterTypes[0].isEnum }
            .sortedBy { it.parameterTypes[0].name }
    }

    private val additions = Class.forName("ch.brickinventoryapp.contract.ErgaenzungenKt").methods.toList()

    /** A value of type [typ]; data classes via their full constructor, every field different. */
    fun fill(typ: Type): Any? {
        val k = when (typ) {
            is Class<*> -> typ
            is ParameterizedType -> typ.rawType as Class<*>
            is WildcardType -> return fill(typ.upperBounds[0])
            else -> error("Typ $typ")
        }
        counter++
        return when {
            k == Int::class.javaPrimitiveType || k == Int::class.javaObjectType -> 100 + counter
            k == Long::class.javaPrimitiveType || k == Long::class.javaObjectType -> 1000L + counter
            k == Double::class.javaPrimitiveType || k == Double::class.javaObjectType -> counter + 0.25
            k == Float::class.javaPrimitiveType || k == Float::class.javaObjectType -> counter + 0.5f
            k == Boolean::class.javaPrimitiveType || k == Boolean::class.javaObjectType -> counter % 2 == 0
            k == String::class.java -> "w$counter"
            k.isEnum -> k.enumConstants.last()
            JsonElement::class.java.isAssignableFrom(k) -> JsonObject(mapOf("k$counter" to JsonPrimitive(counter)))
            List::class.java.isAssignableFrom(k) -> {
                val t = (typ as ParameterizedType).actualTypeArguments[0]
                listOf(fill(t), fill(t))
            }
            Map::class.java.isAssignableFrom(k) ->
                mapOf("k$counter" to fill((typ as ParameterizedType).actualTypeArguments[1]))
            else -> {
                val c = k.declaredConstructors
                    .filter { kon -> kon.parameterTypes.none { it.name.endsWith("ConstructorMarker") } }
                    .maxBy { it.parameterCount }
                c.isAccessible = true
                c.newInstance(*c.genericParameterTypes.map { fill(it) }.toTypedArray())
            }
        }
    }

    /**
     * Compares the getters of the same name of [dto] and [ansicht], nested;
     * getters without counterpart land in [ohne]. Returns the number of compared fields.
     */
    fun compare(dto: Any?, ansicht: Any?, pfad: String, ohne: MutableSet<String>): Int {
        if (ansicht == null || dto == null || !ansicht.javaClass.name.startsWith("ch.brickinventoryapp.model.domain.")) {
            assertEquals(pfad, dto, ansicht)
            return 1
        }
        val k = ansicht.javaClass
        var n = 0
        for (g in getter(k)) {
            val gegen = counterpart(dto, g)
            // Derived values of the generated types stand as extensions in Ergaenzungen.kt.
            val extended = additions.firstOrNull { it.name == g.name.substringBefore('-') && it.parameterTypes.singleOrNull() == dto.javaClass }
            val wert = when {
                gegen != null -> gegen.invoke(dto)
                extended != null -> extended.invoke(null, dto)
                else -> { ohne += "${dto.javaClass.simpleName}.${g.name}"; continue }
            }
            n += compareValue(fachwert(wert, g.returnType), g.invoke(ansicht), "$pfad.${g.name}", ohne)
        }
        return n
    }

    /** Static getters (Herkunft.getEntries) belong to the class, not to the value. */
    private fun getter(k: Class<*>): List<Method> = k.methods.filter {
        it.parameterCount == 0 && it.declaringClass == k && !Modifier.isStatic(it.modifiers) &&
            (it.name.startsWith("get") || it.name.startsWith("is"))
    }

    /** A getter on a value class carries a suffix (getAmount-…); Geld and Double have different ones. */
    private fun counterpart(dto: Any, g: Method): Method? =
        dto.javaClass.methods.firstOrNull { it.name == g.name && it.parameterCount == 0 }
            ?: dto.javaClass.methods.firstOrNull { it.parameterCount == 0 && "-" in g.name && it.name == g.name.substringBefore('-') }

    /** The value of the server model as the mapping should read it: amount as Geld, time as Instant. */
    private fun fachwert(d: Any?, typ: Class<*>): Any? = when {
        d is Double && typ == Geld::class.java -> Geld.aus(d)
        d is Double && typ == Long::class.javaPrimitiveType -> Geld.aus(d)?.tenThousandths
        typ == Instant::class.java -> zeitpunkt(d as String?)
        typ == Herkunft::class.java -> Herkunft.aus(d as String?)
        else -> d
    }

    /** Lists and maps entry by entry, everything else via [compare]. */
    private fun compareValue(d: Any?, a: Any?, pfad: String, ohne: MutableSet<String>): Int = when {
        a is List<*> && d is List<*> -> {
            assertEquals("$pfad (Länge)", d.size, a.size)
            a.indices.sumOf { compare(d[it], a[it], "$pfad[$it]", ohne) }
        }
        a is Map<*, *> && d is Map<*, *> -> {
            assertEquals("$pfad (Schlüssel)", d.keys, a.keys)
            a.keys.sumOf { compare(d[it], a[it], "$pfad[$it]", ohne) }
        }
        else -> compare(d, a, pfad, ohne)
    }
}
