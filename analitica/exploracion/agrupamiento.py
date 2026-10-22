"""Exploracion del agrupamiento (Capitulo 2, seccion 2.1.9; CRISP-DM, modelado).

Dos preguntas, con k-means y el numero de grupos elegido con el metodo del codo
y el coeficiente de silueta, y evaluado tambien con el indice de Davies-Bouldin:

1. Que estaciones se comportan parecido: cada estacion se describe con su
   perfil horario de PM2.5 (promedio de cada hora del dia). El perfil se
   estandariza por estacion, asi que se agrupa la forma del ciclo diario y no
   el nivel: las estaciones del DAGMA y del IDEAM son de 2010-2024 y las de
   SATIC de 2026, y sus niveles no son comparables.
2. Que tipos de dia hay: cada dia de cada estacion se describe con su PM2.5 y
   su meteorologia (temperatura, humedad, viento y lluvia), estandarizados.

Entrada: los CSV de consultas.sql.
    python agrupamiento.py perfil_horario.csv diario.csv carpeta_salida
"""
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.cluster import KMeans  # noqa: E402
from sklearn.metrics import davies_bouldin_score, silhouette_score  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402

SEMILLA = 42
# Paleta categorica validada (guia de visualizacion): un color fijo por grupo.
COLORES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#6250d6"]
TINTA, TINTA_SUAVE, REJILLA = "#0b0b0b", "#52514e", "#e6e5e0"
HORAS_MINIMAS_ESTACION = 500

plt.rcParams.update({
    "font.family": "sans-serif", "font.size": 10, "axes.edgecolor": REJILLA, "axes.labelcolor": TINTA_SUAVE,
    "xtick.color": TINTA_SUAVE, "ytick.color": TINTA_SUAVE, "axes.spines.top": False,
    "axes.spines.right": False, "axes.grid": True, "grid.color": REJILLA, "grid.linewidth": 0.8,
    "axes.titlesize": 11, "axes.titleweight": "bold", "axes.titlecolor": TINTA, "figure.dpi": 150,
})


def evaluar_k(datos: np.ndarray, valores_k, muestra: int | None = None) -> pd.DataFrame:
    """Inercia (codo), silueta y Davies-Bouldin para cada k."""
    filas = []
    for k in valores_k:
        modelo = KMeans(n_clusters=k, n_init=20, random_state=SEMILLA).fit(datos)
        etiquetas = modelo.labels_
        silueta = silhouette_score(datos, etiquetas, sample_size=muestra, random_state=SEMILLA)
        filas.append({"k": k, "inercia": modelo.inertia_, "silueta": silueta,
                      "davies_bouldin": davies_bouldin_score(datos, etiquetas)})
    return pd.DataFrame(filas)


def grafica_codo(evaluacion: pd.DataFrame, k_elegido: int, titulo: str, ruta: Path):
    """Dos paneles con su propio eje (nunca un eje doble): inercia y silueta."""
    figura, (izq, der) = plt.subplots(1, 2, figsize=(8.4, 3.2))
    for eje, columna, nombre in [(izq, "inercia", "Dispersión dentro de los grupos (inercia)"),
                                 (der, "silueta", "Coeficiente de silueta promedio")]:
        eje.plot(evaluacion.k, evaluacion[columna], color=COLORES[0], linewidth=2, marker="o", markersize=5)
        fila = evaluacion[evaluacion.k == k_elegido].iloc[0]
        eje.plot([k_elegido], [fila[columna]], marker="o", markersize=10, markerfacecolor="none",
                 markeredgecolor=TINTA, markeredgewidth=1.5)
        eje.set_title(nombre, loc="left")
        eje.set_xlabel("Número de grupos (k)")
        eje.set_xticks(evaluacion.k)
    figura.suptitle(titulo, x=0.01, ha="left", fontsize=12, fontweight="bold", color=TINTA)
    figura.text(0.01, -0.04, f"El círculo marca el k elegido ({k_elegido}).", color=TINTA_SUAVE, fontsize=9)
    figura.tight_layout()
    figura.savefig(ruta, bbox_inches="tight")
    plt.close(figura)


def estaciones(perfiles_csv: Path, salida: Path) -> str:
    datos = pd.read_csv(perfiles_csv)
    datos["etiqueta"] = datos.nombre + " (" + datos.fuente.str.split(" ").str[0] + ")"
    horas = datos.groupby("etiqueta").n.sum()
    tabla = datos.pivot_table(index="etiqueta", columns="hora", values="pm25")
    tabla = tabla.loc[(horas >= HORAS_MINIMAS_ESTACION) & tabla.notna().all(axis=1)]
    # Javeriana marca 0 todo el mes (sensor detenido): no tiene forma que agrupar.
    tabla = tabla[tabla.std(axis=1) > 0]
    nivel = tabla.mean(axis=1)
    forma = tabla.sub(nivel, axis=0).div(tabla.std(axis=1), axis=0)

    evaluacion = evaluar_k(forma.values, range(2, 7))
    k = int(evaluacion.loc[evaluacion.silueta.idxmax(), "k"])
    grafica_codo(evaluacion, k, "Estaciones por la forma de su ciclo diario de PM2.5", salida / "estaciones_codo.png")
    modelo = KMeans(n_clusters=k, n_init=20, random_state=SEMILLA).fit(forma.values)
    grupos = pd.Series(modelo.labels_, index=forma.index)
    # Los grupos se numeran por tamaño, para que el color no dependa de la semilla.
    orden = {g: i for i, g in enumerate(grupos.value_counts().index)}
    grupos = grupos.map(orden)

    figura, ejes = plt.subplots(1, k, figsize=(4.0 * k, 3.4), sharey=True)
    for g, eje in enumerate(np.atleast_1d(ejes)):
        miembros = forma[grupos == g]
        for _, perfil in miembros.iterrows():
            eje.plot(perfil.index, perfil.values, color=COLORES[g], linewidth=1, alpha=0.35)
        eje.plot(miembros.columns, miembros.mean(), color=COLORES[g], linewidth=2.5)
        eje.set_title(f"Grupo {g + 1}: {len(miembros)} estaciones", loc="left")
        eje.set_xlabel("Hora del día (Colombia)")
        eje.set_xticks(range(0, 24, 3))
    np.atleast_1d(ejes)[0].set_ylabel("PM2.5 estandarizado\n(desviaciones de su promedio)")
    figura.text(0.01, -0.03, "Cada línea delgada es una estación; la gruesa, el promedio del grupo.",
                color=TINTA_SUAVE, fontsize=9)
    figura.tight_layout()
    figura.savefig(salida / "estaciones_perfiles.png", bbox_inches="tight")
    plt.close(figura)

    resumen = pd.DataFrame({"grupo": grupos + 1, "pm25_promedio": nivel.round(1),
                            "hora_pico": tabla.idxmax(axis=1), "hora_minimo": tabla.idxmin(axis=1)})
    resumen.sort_values(["grupo", "pm25_promedio"]).to_csv(salida / "estaciones_grupos.csv")
    texto = [f"## Estaciones (k = {k})", "", evaluacion.round(3).to_markdown(index=False), ""]
    for g in range(k):
        r = resumen[resumen.grupo == g + 1]
        texto.append(f"**Grupo {g + 1}** ({len(r)}): " + "; ".join(
            f"{e} [pico {int(f.hora_pico)} h, {f.pm25_promedio} µg/m³]" for e, f in r.iterrows()))
    return "\n".join(texto)


def dias(diario_csv: Path, salida: Path) -> str:
    datos = pd.read_csv(diario_csv)
    tabla = datos.pivot_table(index=["nombre", "fuente", "dia"], columns="codigo", values="valor").dropna()
    variables = ["PM25", "TEMP", "HUM", "VV", "LLUVIA"]
    tabla = tabla[variables].reset_index()
    # La lluvia diaria es muy asimetrica (casi siempre poca, a veces mucha).
    matriz = tabla[variables].assign(LLUVIA=np.log1p(tabla.LLUVIA))
    escalada = StandardScaler().fit_transform(matriz)

    # Hasta 6 grupos: mas tipos de dia no se pueden interpretar (ni distinguir por color).
    evaluacion = evaluar_k(escalada, range(2, 7), muestra=5000)
    k = int(evaluacion.loc[evaluacion.silueta.idxmax(), "k"])
    grafica_codo(evaluacion, k, f"Tipos de día ({len(tabla):,} días con PM2.5 y meteorología completos)"
                 .replace(",", "."), salida / "dias_codo.png")
    modelo = KMeans(n_clusters=k, n_init=20, random_state=SEMILLA).fit(escalada)
    tabla["grupo"] = modelo.labels_
    orden = {g: i for i, g in enumerate(tabla.groupby("grupo").PM25.mean().sort_values().index)}
    tabla["grupo"] = tabla.grupo.map(orden) + 1  # grupo 1 = el de menos PM2.5

    centros = tabla.groupby("grupo")[variables].mean().round(1)
    centros["días"] = tabla.groupby("grupo").size()
    centros.to_csv(salida / "dias_centros.csv")

    # Distribucion de los grupos por mes: las temporadas de lluvia de Cali
    # (abril-mayo y octubre-noviembre) deberian notarse si los grupos tienen sentido.
    tabla["mes"] = pd.to_datetime(tabla.dia).dt.month
    por_mes = pd.crosstab(tabla.mes, tabla.grupo, normalize="index")
    figura, eje = plt.subplots(figsize=(8.4, 3.4))
    base = np.zeros(12)
    for g in por_mes.columns:
        eje.bar(por_mes.index, por_mes[g], bottom=base, color=COLORES[g - 1], width=0.8,
                edgecolor="#fcfcfb", linewidth=2, label=f"Grupo {g}")
        base += por_mes[g].values
    eje.set_xticks(range(1, 13), ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"])
    eje.set_ylabel("Proporción de días")
    eje.set_title("Proporción de cada tipo de día por mes", loc="left")
    eje.legend(ncol=k, frameon=False, loc="upper left", bbox_to_anchor=(0, -0.12))
    eje.grid(axis="x", visible=False)
    figura.tight_layout()
    figura.savefig(salida / "dias_por_mes.png", bbox_inches="tight")
    plt.close(figura)

    estaciones_grupo = pd.crosstab(tabla.nombre, tabla.grupo, normalize="index").round(2)
    estaciones_grupo.to_csv(salida / "dias_por_estacion.csv")
    return "\n".join([f"## Días (k = {k})", "", evaluacion.round(3).to_markdown(index=False), "",
                      centros.to_markdown(), "", estaciones_grupo.to_markdown()])


if __name__ == "__main__":
    perfiles, diario, carpeta = (Path(a) for a in sys.argv[1:4])
    carpeta.mkdir(parents=True, exist_ok=True)
    informe = estaciones(perfiles, carpeta) + "\n\n" + dias(diario, carpeta)
    (carpeta / "resultados.md").write_text(informe)
    print(informe)
