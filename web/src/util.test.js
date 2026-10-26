import { describe, expect, it } from "vitest";
import {
  agruparEstaciones, antiguedad, antiguedadCorta, claveEstacion, fechaCorta, periodoRuido, esReciente, estadoMasReciente, formatearFecha, formatearNumero, puntoEnGeometria,
  marcasEje, restarDias, textoSobre, zonaDe, zonasConEstacion,
} from "./util.js";

const punto = (id, nombre, fuente, lon, lat, parametros = {}) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lon, lat] },
  properties: { id, nombre, fuente, parametros },
});

describe("agruparEstaciones", () => {
  it("une la misma estación publicada por dos fuentes y usa las coordenadas oficiales", () => {
    const grupos = agruparEstaciones({ features: [
      // El IDEAM publica Era Obrero con las coordenadas de Base Aérea.
      punto(1, "Era Obrero", "IDEAM - datos.gov.co", -76.50654, 3.45732),
      punto(2, "ERA - Obrero", "Datos Abiertos de Cali (DAGMA)", -76.51908, 3.44759),
      punto(3, "Pance", "Datos Abiertos de Cali (DAGMA)", -76.5312, 3.3045),
    ] });
    expect(grupos).toHaveLength(2);
    const era = grupos.find((g) => g.nombre === "ERA - Obrero");
    expect(era.registros.map((r) => r.id)).toEqual([1, 2]);
    expect(era.coordenadas).toEqual([-76.51908, 3.44759]);
  });
  it("normaliza los nombres de las estaciones", () => {
    expect(claveEstacion("Transitoria EDB Navarro")).toBe(claveEstacion("Transitoria-Navarro"));
    expect(claveEstacion("Universidad Del Valle")).toBe(claveEstacion("Universidad del Valle"));
    expect(claveEstacion("Base Aérea")).toBe("base aerea");
  });
});

describe("estadoMasReciente", () => {
  it("prefiere el ICA más reciente entre las fuentes", () => {
    const [grupo] = agruparEstaciones({ features: [
      punto(1, "A", "Cali", -76.5, 3.4, { PM25: { instante: "2020-01-01T05:00:00+00:00", instante_ica: "2020-01-01T05:00:00+00:00", categoria: "Buena" } }),
      punto(2, "A", "IDEAM", -76.5, 3.4, { PM25: { instante: "2022-06-15T05:00:00+00:00", instante_ica: "2022-06-10T05:00:00+00:00", categoria: "Aceptable" } }),
      punto(3, "A", "Otra", -76.5, 3.4, { PM25: { instante: "2023-01-01T05:00:00+00:00", instante_ica: null, categoria: null } }),
    ] });
    expect(estadoMasReciente(grupo, "PM25").registro.fuente).toBe("IDEAM");
    expect(estadoMasReciente(grupo, "PM10")).toBeNull();
  });
});

describe("formatos", () => {
  it("muestra las fechas en hora de Colombia", () => {
    expect(formatearFecha("2025-01-01T05:00:00+00:00")).toMatch(/01.*ene.*2025.*00:00/);
  });
  it("expresa la antigüedad del dato", () => {
    expect(antiguedad("2020-01-01T00:00:00Z", new Date("2026-10-09T00:00:00Z"))).toBe("hace 6 años");
    expect(antiguedad("2026-09-30T00:00:00Z", new Date("2026-10-09T00:00:00Z"))).toBe("hace 9 días");
    // Los datos de SATIC llegan con una o dos horas de retraso: se cuentan en horas.
    expect(antiguedad("2026-10-22T06:00:00Z", new Date("2026-10-22T08:10:00Z"))).toBe("hace 2 horas");
    expect(antiguedad("2026-10-22T08:00:00Z", new Date("2026-10-22T08:10:00Z"))).toBe("hace menos de una hora");
  });
  it("elige texto oscuro sobre amarillo y claro sobre marrón", () => {
    expect(textoSobre("#FFFF00")).toBe("#1a1a1a");
    expect(textoSobre("#7E0023")).toBe("#ffffff");
  });
  it("usa coma decimal", () => {
    expect(formatearNumero(14.25)).toBe("14,3");
    expect(formatearNumero(null)).toBe("—");
  });
  it("resta días a una fecha", () => {
    expect(restarDias("2025-01-01", 30)).toBe("2024-12-02");
  });
});

describe("zonas con estación", () => {
  const cuadrado = (x0, y0, lado) => ({ type: "Polygon", coordinates: [[[x0, y0], [x0 + lado, y0], [x0 + lado, y0 + lado], [x0, y0 + lado], [x0, y0]]] });
  const zona = (tipo, codigo, geometry) => ({ type: "Feature", geometry, properties: { tipo, codigo, nombre: `${tipo} ${codigo}` } });
  const estacion = (id, coordenadas, ica, color) => ({
    id, coordenadas, registros: [{ parametros: { PM25: { categoria: "x", ica, color, instante_ica: "2022-01-01T00:00:00+00:00", instante: "2022-01-01T00:00:00+00:00" } } }],
  });

  it("detecta si un punto está dentro de un polígono con hueco", () => {
    const conHueco = { type: "Polygon", coordinates: [cuadrado(0, 0, 10).coordinates[0], cuadrado(4, 4, 2).coordinates[0]] };
    expect(puntoEnGeometria([1, 1], conHueco)).toBe(true);
    expect(puntoEnGeometria([5, 5], conHueco)).toBe(false);
    expect(puntoEnGeometria([11, 1], conHueco)).toBe(false);
  });

  it("colorea la comuna con la peor categoría y usa el corregimiento para las estaciones rurales", () => {
    const capas = {
      comuna: { features: [zona("comuna", "01", cuadrado(0, 0, 10))] },
      corregimiento: { features: [zona("corregimiento", "51", cuadrado(20, 0, 10))] },
    };
    const grupos = [estacion(1, [2, 2], 30, "#00E400"), estacion(2, [5, 5], 60, "#FFFF00"), estacion(3, [25, 5], 10, "#00E400"),
                    estacion(4, [50, 50], 90, "#FF7E00")];
    const resultado = zonasConEstacion(capas, grupos, "PM25").features;
    expect(resultado.map((f) => [f.properties.nombre, f.properties.color])).toEqual([
      ["comuna 01", "#FFFF00"], ["corregimiento 51", "#00E400"]]);
  });
});

describe("zona de una estación", () => {
  const cuadrado = (x0, lado) => ({ type: "Polygon", coordinates: [[[x0, 0], [x0 + lado, 0], [x0 + lado, lado], [x0, lado], [x0, 0]]] });
  const capas = {
    comuna: { features: [{ geometry: cuadrado(0, 10), properties: { tipo: "comuna", codigo: "07", nombre: "Comuna 07" } }] },
    corregimiento: { features: [{ geometry: cuadrado(20, 10), properties: { tipo: "corregimiento", codigo: "53", nombre: "Pance" } }] },
  };
  it("nombra la comuna sin ceros y el corregimiento por su nombre", () => {
    expect(zonaDe(capas, [5, 5])).toBe("Comuna 7");
    expect(zonaDe(capas, [25, 5])).toBe("Corregimiento Pance");
    expect(zonaDe(capas, [50, 5])).toBeNull();
  });
});

describe("datos recientes", () => {
  const ahora = new Date("2026-10-22T08:00:00Z");
  it("considera recientes los datos de las últimas 48 horas", () => {
    expect(esReciente("2026-10-21T06:00:00Z", ahora)).toBe(true);
    expect(esReciente("2026-10-19T06:00:00Z", ahora)).toBe(false);
    expect(esReciente(null, ahora)).toBe(false);
  });
  it("resume la fecha y la antigüedad de los datos recientes", () => {
    expect(antiguedadCorta("2026-10-22T05:00:00Z", ahora)).toBe("hace 3 h");
    expect(antiguedadCorta("2026-10-18T05:00:00Z", ahora)).toBe("hace 4 d");
    // 08:00 UTC son las 03:00 en Colombia.
    expect(fechaCorta("2026-10-22T08:00:00Z", ahora)).toBe("hoy, 03:00");
    expect(fechaCorta("2026-10-21T08:00:00Z", ahora)).toBe("ayer, 03:00");
  });
  it("con soloRecientes ignora las fuentes viejas y las variables sin valor válido", () => {
    const [grupo] = agruparEstaciones({ features: [
      punto(1, "A", "IDEAM", -76.5, 3.4, { PM25: { instante: "2024-04-01T05:00:00Z", instante_ica: "2024-04-01T05:00:00Z", categoria: "Buena" } }),
      punto(2, "A", "SATIC", -76.5, 3.4, { PM25: { instante: null, instante_ica: null, categoria: null,
                                                   ultima_marcada: { instante: "2026-10-22T07:00:00Z", bandera: "sospechoso" } } }),
    ] });
    expect(estadoMasReciente(grupo, "PM25", { ahora }).registro.fuente).toBe("IDEAM");
    expect(estadoMasReciente(grupo, "PM25", { soloRecientes: true, ahora })).toBeNull();
  });
});

describe("ruido", () => {
  it("separa el día y la noche como la Resolución 627 de 2006", () => {
    // Hora que termina a las 8:00 en Colombia (13:00 UTC): de día. La que termina a las 7:00: de noche.
    expect(periodoRuido("2026-10-22T13:00:00Z")).toBe("Día");
    expect(periodoRuido("2026-10-22T12:00:00Z")).toBe("Noche");
    expect(periodoRuido("2026-10-23T02:00:00Z")).toBe("Día"); // 21:00
    expect(periodoRuido("2026-10-23T03:00:00Z")).toBe("Noche"); // 22:00
  });
});

describe("marcas del eje", () => {
  it("usa pasos redondos que cubren el máximo", () => {
    expect(marcasEje(223)).toEqual([0, 50, 100, 150, 200, 250]);
    expect(marcasEje(37)).toEqual([0, 10, 20, 30, 40]);
    expect(marcasEje(1.3)).toEqual([0, 0.5, 1, 1.5]);
  });
  it("no se pasa cuando el máximo cae justo en una marca", () => {
    expect(marcasEje(100)).toEqual([0, 20, 40, 60, 80, 100]);
  });
  it("devuelve un eje mínimo sin datos", () => {
    expect(marcasEje(0)).toEqual([0, 1]);
  });
});
