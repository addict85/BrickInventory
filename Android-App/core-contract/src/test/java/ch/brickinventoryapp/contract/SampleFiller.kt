package ch.brickinventoryapp.contract

import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.Origin
import ch.brickinventoryapp.model.util.parseInstant
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import java.io.File
import java.lang.reflect.Method
import java.lang.reflect.Modifier
import java.lang.reflect.ParameterizedType
import java.lang.reflect.Type
import java.lang.reflect.WildcardType
import java.time.Instant

/**
 * Builds server models in which every field has its own value, and
 * compares them with their view — via Java reflection, so that every new
 * mapping in contract/mapping is checked along without its own test.
 */
object SampleFiller {
    private var counter = 0

    /**
     * The files in contract/mapping, named by name: under Gradle
     * the main classes lie in a jar, a folder walk found nothing there.
     * That the list is complete is checked by UiModelFigureTest on the source.
     */
    val MAPPING_FILES = listOf(
        "SingleMappings", "FinanceMappings", "VoucherPlaintextMapping", "HouseholdMappings", "BackgroundMappings",
        "CatalogMappings", "AccountMappings", "PriceMappings", "SetMappings", "PartsMappings", "AdminMappings",
    )

    /** All `asView(<vertrag.X>)` of the files in [MAPPING_FILES]. */
    fun figures(): List<Method> {
        return MAPPING_FILES.map { Class.forName("ch.brickinventoryapp.contract.mapping.${it}Kt") }
            .flatMap { k -> k.methods.filter { it.name == "asView" && it.parameterCount == 1 } }
            .filter { it.parameterTypes[0].name.startsWith("ch.brickinventoryapp.contract.") && !it.parameterTypes[0].isEnum }
            .sortedBy { it.parameterTypes[0].name }
    }

    private val additions = Class.forName("ch.brickinventoryapp.contract.SupplementsKt").methods.toList()

    /** A value of type [type]; data classes via their full constructor, every field different. */
    fun fill(type: Type): Any? {
        val k = when (type) {
            is Class<*> -> type
            is ParameterizedType -> type.rawType as Class<*>
            is WildcardType -> return fill(type.upperBounds[0])
            else -> error("Typ $type")
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
                val t = (type as ParameterizedType).actualTypeArguments[0]
                listOf(fill(t), fill(t))
            }
            Map::class.java.isAssignableFrom(k) ->
                mapOf("k$counter" to fill((type as ParameterizedType).actualTypeArguments[1]))
            else -> {
                val c = k.declaredConstructors
                    .filter { con -> con.parameterTypes.none { it.name.endsWith("ConstructorMarker") } }
                    .maxBy { it.parameterCount }
                c.isAccessible = true
                c.newInstance(*c.genericParameterTypes.map { fill(it) }.toTypedArray())
            }
        }
    }

    /**
     * Compares the getters of the same name of [dto] and [view], nested;
     * getters without counterpart land in [without]. Returns the number of compared fields.
     */
    fun compare(dto: Any?, view: Any?, path: String, without: MutableSet<String>): Int {
        if (view == null || dto == null || !view.javaClass.name.startsWith("ch.brickinventoryapp.model.domain.")) {
            assertEquals(path, dto, view)
            return 1
        }
        val k = view.javaClass
        var n = 0
        for (g in getter(k)) {
            val against = counterpart(dto, g)
            // Derived values of the generated types stand as extensions in Supplements.kt.
            val extended = additions.firstOrNull { it.name == g.name.substringBefore('-') && it.parameterTypes.singleOrNull() == dto.javaClass }
            val value = when {
                against != null -> against.invoke(dto)
                extended != null -> extended.invoke(null, dto)
                else -> { without += "${dto.javaClass.simpleName}.${g.name}"; continue }
            }
            n += compareValue(domainValue(value, g.returnType), g.invoke(view), "$path.${g.name}", without)
        }
        return n
    }

    /** Static getters (Origin.getEntries) belong to the class, not to the value. */
    private fun getter(k: Class<*>): List<Method> = k.methods.filter {
        it.parameterCount == 0 && it.declaringClass == k && !Modifier.isStatic(it.modifiers) &&
            (it.name.startsWith("get") || it.name.startsWith("is"))
    }

    /** A getter on a value class carries a suffix (getAmount-…); Money and Double have different ones. */
    private fun counterpart(dto: Any, g: Method): Method? {
        val own = instanceGetters(dto.javaClass)
        return own.firstOrNull { it.name == g.name }
            ?: own.firstOrNull { "-" in g.name && it.name == g.name.substringBefore('-') }
            ?: own.firstOrNull { english(it.name) == g.name.substringBefore('-') }
    }

    /**
     * Getters that read a value. The static `getX-hash$annotations()` holder has the same name
     * up to the suffix and returns null; `methods` comes in no fixed order, so it won at random.
     */
    fun instanceGetters(k: Class<*>): List<Method> = k.methods.filter {
        it.parameterCount == 0 && !Modifier.isStatic(it.modifiers) && it.returnType != Void.TYPE
    }

    /** The contract keeps German property names until API v2; the view carries the English one. */
    private val contractNames: Map<String, String> = File("src/test/resources/contract-property-names.txt").readLines()
        .filter { it.isNotBlank() && !it.startsWith("#") }.associate { it.substringBefore(' ') to it.substringAfter(' ') }

    private fun english(getter: String): String? {
        val name = getter.substringBefore('-').removePrefix("get").replaceFirstChar { it.lowercase() }
        return contractNames[name]?.let { "get" + it.replaceFirstChar { c -> c.uppercase() } }
    }

    /** The value of the server model as the mapping should read it: amount as Money, time as Instant. */
    private fun domainValue(d: Any?, type: Class<*>): Any? = when {
        d is Double && type == Money::class.java -> Money.from(d)
        d is Double && type == Long::class.javaPrimitiveType -> Money.from(d)?.tenThousandths
        type == Instant::class.java -> parseInstant(d as String?)
        type == Origin::class.java -> Origin.from(d as String?)
        else -> d
    }

    /** Lists and maps entry by entry, everything else via [compare]. */
    private fun compareValue(d: Any?, a: Any?, path: String, without: MutableSet<String>): Int = when {
        a is List<*> && d is List<*> -> {
            assertEquals("$path (length)", d.size, a.size)
            a.indices.sumOf { compare(d[it], a[it], "$path[$it]", without) }
        }
        a is Map<*, *> && d is Map<*, *> -> {
            assertEquals("$path (keys)", d.keys, a.keys)
            a.keys.sumOf { compare(d[it], a[it], "$path[$it]", without) }
        }
        else -> compare(d, a, path, without)
    }
}
