import { describe, expect, it } from "vitest";
import { esNuevoPaso, escribirUrl, leerUrl } from "./url.js";

describe("estado en la URL", () => {
  it("sin parámetros abre el mapa con los valores iniciales", () => {
    expect(leerUrl("")).toEqual({ vista: "mapa", variable: null, estacion: null, soloRecientes: true });
    expect(escribirUrl({ vista: "mapa", variable: "PM25", estacion: null, soloRecientes: true })).toBe("");
  });

  it("ida y vuelta de una estación del mapa", () => {
    const estado = { vista: "mapa", variable: "PM10", estacion: "universidad-libre", soloRecientes: false };
    const url = escribirUrl(estado);
    expect(url).toBe("?estacion=universidad-libre&variable=PM10&vigencia=todo");
    expect(leerUrl(url)).toEqual(estado);
  });

  it("ida y vuelta de una consulta del Histórico", () => {
    const estado = { vista: "historico", variable: "PM25", serie: 12, desde: "2026-10-01", hasta: "2026-10-31" };
    expect(leerUrl(escribirUrl(estado))).toEqual(estado);
  });

  it("ignora los valores que no tienen la forma esperada", () => {
    expect(leerUrl("?vista=otra")).toMatchObject({ vista: "mapa" });
    expect(leerUrl("?estacion=<script>&variable=pm25")).toMatchObject({ estacion: null, variable: null });
    expect(leerUrl("?vista=historico&serie=-3&desde=ayer&hasta=2026-13")).toMatchObject(
      { serie: null, desde: null, hasta: null });
  });

  it("solo la pestaña y la estación crean un paso nuevo en el historial", () => {
    const mapa = { vista: "mapa", estacion: "pance", variable: "PM25", soloRecientes: true };
    expect(esNuevoPaso(null, mapa)).toBe(false);
    expect(esNuevoPaso(mapa, { ...mapa, estacion: "cascajal" })).toBe(true);
    expect(esNuevoPaso(mapa, { ...mapa, variable: "PM10" })).toBe(false);
    expect(esNuevoPaso(mapa, { vista: "historico" })).toBe(true);
  });
});
