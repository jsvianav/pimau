import { useCallback, useEffect, useState } from "react";
import { apiAdmin } from "../api.js";
import { formatearFecha, formatearNumero } from "../util.js";

// Flujo F3 (incremento 3): el administrador inicia sesión, revisa el estado de
// la ingesta de cada fuente (RF-11), la activa o desactiva y cambia su
// frecuencia (RF-10). Cada cambio queda en el registro de auditoría.

const CLAVE_SESION = "pimau.sesion-admin";

const FRECUENCIAS = [
  [15, "Cada 15 min"], [60, "Cada hora"], [360, "Cada 6 horas"], [1440, "Cada día"],
  [10080, "Cada semana"], [43200, "Cada 30 días"],
];

const ESTADOS = {
  correcta: "Correcta",
  con_error: "Con error",
  en_curso: "En curso",
};

// La sesión vive solo en esta pestaña del navegador y vence con el token.
function sesionGuardada() {
  try {
    const sesion = JSON.parse(window.sessionStorage.getItem(CLAVE_SESION));
    return sesion && new Date(sesion.expira) > new Date() ? sesion : null;
  } catch {
    return null;
  }
}

function guardarSesion(sesion) {
  try {
    if (sesion) window.sessionStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
    else window.sessionStorage.removeItem(CLAVE_SESION);
  } catch { /* sin almacenamiento: la sesión dura mientras la página esté abierta */ }
}

// Botón de guardar de una fila. Sin cambios queda en su lugar, silencioso y con
// aria-disabled en vez de disabled, para que el foco no se pierda al guardar;
// después de guardar dice "Guardado" en la misma fila.
function BotonGuardar({ cambiada, guardando, guardada, texto, nombre, onGuardar }) {
  const etiqueta = guardando ? "Guardando…" : cambiada ? texto : guardada ? "Guardado" : "Sin cambios";
  return (
    <button type="button" aria-label={`${etiqueta} (${nombre})`} aria-disabled={!cambiada || guardando}
            className={`boton${cambiada ? "" : " silencioso"}${guardada && !cambiada ? " guardado" : ""}`}
            onClick={() => { if (cambiada && !guardando) onGuardar(); }}>
      {guardada && !cambiada && !guardando && (
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                strokeLinejoin="round" />
        </svg>
      )}
      {etiqueta}
    </button>
  );
}

function textoFrecuencia(minutos) {
  return FRECUENCIAS.find(([m]) => m === minutos)?.[1] || `Cada ${minutos} min`;
}

function InicioSesion({ onSesion, aviso }) {
  const [correo, setCorreo] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  function enviar(e) {
    e.preventDefault();
    setEnviando(true); setError(null);
    apiAdmin.iniciarSesion(correo, clave)
      .then(onSesion)
      .catch((err) => setError(err.message))
      .finally(() => setEnviando(false));
  }

  return (
    <form className="inicio-sesion" onSubmit={enviar}>
      <h2>Administración</h2>
      <p className="nota">Solo para el administrador de la plataforma. La consulta de los datos no requiere cuenta.</p>
      {aviso && <p className="aviso-calidad" role="status">{aviso}</p>}
      <label>Correo
        <input type="email" autoComplete="username" required value={correo} onChange={(e) => setCorreo(e.target.value)} />
      </label>
      <label>Contraseña
        <input type="password" autoComplete="current-password" required value={clave}
               onChange={(e) => setClave(e.target.value)} />
      </label>
      {error && <p className="aviso error" role="alert">{error}</p>}
      <button className="boton primario" type="submit" disabled={enviando}>
        {enviando ? "Iniciando sesión…" : "Iniciar sesión"}
      </button>
    </form>
  );
}

function FilaFuente({ fuente, onGuardar, guardada }) {
  const [activa, setActiva] = useState(fuente.activa);
  const [frecuencia, setFrecuencia] = useState(fuente.frecuencia_min);
  const [guardando, setGuardando] = useState(false);
  const cambiada = activa !== fuente.activa || frecuencia !== fuente.frecuencia_min;
  const ultima = fuente.ultima_ejecucion;
  // Una ejecución correcta puede traer advertencias, como una descarga que lleva horas fallando.
  const conAdvertencia = ultima?.estado === "correcta" && ultima.mensaje?.includes("Advertencia");
  const opciones = FRECUENCIAS.some(([m]) => m === fuente.frecuencia_min)
    ? FRECUENCIAS : [[fuente.frecuencia_min, textoFrecuencia(fuente.frecuencia_min)], ...FRECUENCIAS];

  function guardar() {
    setGuardando(true);
    onGuardar(fuente.id, { activa, frecuencia_min: frecuencia }).finally(() => setGuardando(false));
  }

  return (
    <tr className={guardada && !cambiada ? "fila-guardada" : undefined}>
      <th scope="row">
        {fuente.nombre}
        <small>{fuente.tipo_api}</small>
      </th>
      <td>
        {!ultima ? <span className="estado-ejecucion">Sin ejecuciones</span>
          : conAdvertencia ? <span className="estado-ejecucion en_curso">Con advertencias</span>
            : <span className={`estado-ejecucion ${ultima.estado}`}>{ESTADOS[ultima.estado]}</span>}
        {ultima?.mensaje && <small className="mensaje-ejecucion">{ultima.mensaje}</small>}
      </td>
      <td>{ultima ? formatearFecha(ultima.inicio) : "—"}</td>
      <td className="numero">{ultima?.registros != null ? formatearNumero(ultima.registros) : "—"}</td>
      <td>
        <select aria-label={`Frecuencia de ${fuente.nombre}`} value={frecuencia}
                onChange={(e) => setFrecuencia(Number(e.target.value))}>
          {opciones.map(([m, texto]) => <option key={m} value={m}>{texto}</option>)}
        </select>
      </td>
      <td>
        <label className="interruptor">
          <input type="checkbox" checked={activa} disabled={!fuente.con_conector && !fuente.activa}
                 aria-label={`${fuente.nombre} activa`}
                 onChange={(e) => setActiva(e.target.checked)} />
          {activa ? "Activa" : "Inactiva"}
        </label>
        {!fuente.con_conector && <small className="sin-conector">Sin conector todavía</small>}
      </td>
      <td>
        <BotonGuardar cambiada={cambiada} guardando={guardando} guardada={guardada} texto="Guardar cambios"
                      nombre={fuente.nombre} onGuardar={guardar} />
      </td>
    </tr>
  );
}

// RF-14: umbral de alerta por parámetro. Se alerta cuando una medición de las
// últimas horas lo iguala o lo supera.
function FilaUmbral({ umbral, onGuardar, guardada }) {
  const [valor, setValor] = useState(umbral.valor ?? "");
  const [activo, setActivo] = useState(umbral.valor == null ? true : umbral.activo);
  const [guardando, setGuardando] = useState(false);
  const numero = Number(String(valor).replace(",", "."));
  const valido = valor !== "" && numero > 0;
  const invalido = valor !== "" && !valido;
  const cambiado = valido && (numero !== umbral.valor || activo !== umbral.activo);

  function guardar() {
    setGuardando(true);
    onGuardar(umbral.codigo, { valor: numero, activo }).finally(() => setGuardando(false));
  }

  return (
    <tr className={guardada && !cambiado ? "fila-guardada" : undefined}>
      <th scope="row">{umbral.nombre}</th>
      <td>
        <input className="campo-umbral" inputMode="decimal" enterKeyHint="done"
               aria-label={`Umbral de ${umbral.nombre} en ${umbral.unidad}`} aria-invalid={invalido || undefined}
               aria-describedby={invalido ? `error-umbral-${umbral.codigo}` : undefined}
               value={valor} placeholder="Sin umbral" onChange={(e) => setValor(e.target.value)} /> {umbral.unidad}
        {invalido && (
          <small className="error-campo" id={`error-umbral-${umbral.codigo}`}>Escriba un número mayor que 0.</small>
        )}
      </td>
      <td>
        <label className="interruptor">
          <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)}
                 aria-label={`Alerta de ${umbral.nombre} activa`} />
          {activo ? "Activa" : "Inactiva"}
        </label>
      </td>
      <td>{umbral.actualizado ? formatearFecha(umbral.actualizado) : "—"}</td>
      <td>
        <BotonGuardar cambiada={cambiado} guardando={guardando} guardada={guardada} texto="Guardar umbral"
                      nombre={umbral.nombre} onGuardar={guardar} />
      </td>
    </tr>
  );
}

function Panel({ sesion, onSalir, onVencida }) {
  const [fuentes, setFuentes] = useState(null);
  const [errores, setErrores] = useState([]);
  const [auditoria, setAuditoria] = useState([]);
  const [umbrales, setUmbrales] = useState([]);
  const [mensaje, setMensaje] = useState(null);
  const [error, setError] = useState(null);
  // Fila guardada por última vez ("fuente-3", "umbral-PM25"), para confirmarlo en la fila.
  const [guardada, setGuardada] = useState(null);

  const manejarError = useCallback((err) => {
    if (err.estado === 401) onVencida();
    else setError(err.message);
  }, [onVencida]);

  const cargar = useCallback(() => {
    Promise.all([
      apiAdmin.fuentes(sesion.token),
      apiAdmin.ejecuciones(sesion.token, { solo_errores: true, limite: 10 }),
      apiAdmin.auditoria(sesion.token),
      apiAdmin.umbrales(sesion.token),
    ])
      .then(([f, e, a, u]) => { setFuentes(f); setErrores(e); setAuditoria(a); setUmbrales(u); setError(null); })
      .catch(manejarError);
  }, [sesion.token, manejarError]);

  useEffect(() => { cargar(); }, [cargar]);

  function guardarUmbral(codigo, cambio) {
    setMensaje(null); setGuardada(null);
    return apiAdmin.configurarUmbral(sesion.token, codigo, cambio)
      .then((u) => {
        setMensaje(`Umbral de ${u.nombre} guardado. El visor lo usa desde su próxima actualización.`);
        setGuardada(`umbral-${codigo}`); cargar();
      })
      .catch(manejarError);
  }

  function guardar(id, cambios) {
    setMensaje(null); setGuardada(null);
    return apiAdmin.cambiarFuente(sesion.token, id, cambios)
      .then((f) => {
        setMensaje(`Cambios guardados en ${f.nombre}. Se aplican en la siguiente ejecución.`);
        setGuardada(`fuente-${id}`); cargar();
      })
      .catch(manejarError);
  }

  return (
    <section className="panel-admin">
      <div className="panel-admin-encabezado">
        <h2>Administración</h2>
        <p>
          Sesión: {sesion.correo}{" "}
          <button className="boton texto" type="button" onClick={onSalir}>Cerrar sesión</button>
        </p>
      </div>
      {mensaje && <p className="aviso exito" role="status">{mensaje}</p>}
      {error && <p className="aviso error" role="alert">{error}</p>}

      <div className="tarjeta">
        <h3>Fuentes de datos</h3>
        <p className="nota">La ingesta revisa cada minuto qué fuentes le toca ejecutar, así que un cambio se aplica en la
          siguiente ejecución, sin reiniciar nada.</p>
        {!fuentes ? <p className="nota">Cargando…</p> : (
          <div className="tabla-desplazable">
            <table className="tabla-fuentes">
              <thead>
                <tr>
                  <th scope="col">Fuente</th><th scope="col">Estado</th><th scope="col">Última ejecución</th>
                  <th scope="col">Registros</th><th scope="col">Frecuencia</th><th scope="col">Activa</th>
                  <th scope="col"><span className="solo-lector">Acción</span></th>
                </tr>
              </thead>
              <tbody>
                {fuentes.map((f) => (
                  // La clave es solo el id: al guardar, la fila no se vuelve a montar y el foco sigue en su botón.
                  <FilaFuente key={f.id} fuente={f} onGuardar={guardar} guardada={guardada === `fuente-${f.id}`} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="tarjeta">
        <h3>Umbrales de alerta</h3>
        <p className="nota">Cuando una medición de las últimas 3 horas iguala o supera el umbral de su variable, el visor
          muestra una alerta. Una variable sin umbral no genera alertas.</p>
        <div className="tabla-desplazable">
          <table className="tabla-fuentes">
            <thead>
              <tr><th scope="col">Variable</th><th scope="col">Umbral</th><th scope="col">Alerta</th>
                <th scope="col">Actualizado</th><th scope="col"><span className="solo-lector">Acción</span></th></tr>
            </thead>
            <tbody>
              {umbrales.map((u) => (
                <FilaUmbral key={u.codigo} umbral={u} onGuardar={guardarUmbral} guardada={guardada === `umbral-${u.codigo}`} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="tarjeta">
        <h3>Errores recientes de la ingesta</h3>
        {errores.length === 0 ? <p className="nota">No hay ejecuciones con error.</p> : (
          <ul className="lista-eventos">
            {errores.map((e) => (
              <li key={`${e.fuente}-${e.inicio}`}>
                <strong>{e.fuente}</strong> · {formatearFecha(e.inicio)}
                <span>{e.mensaje}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="tarjeta">
        <h3>Registro de auditoría</h3>
        <p className="nota">Cada inicio de sesión, cada intento sin permiso y cada cambio quedan registrados.</p>
        <div className="tabla-desplazable">
          <table className="tabla-auditoria">
            <thead>
              <tr><th scope="col">Fecha</th><th scope="col">Quién</th><th scope="col">Acción</th>
                <th scope="col">Resultado</th><th scope="col">IP</th></tr>
            </thead>
            <tbody>
              {auditoria.map((a, i) => (
                <tr key={`${a.instante}-${i}`}>
                  <td>{formatearFecha(a.instante)}</td>
                  <td>{a.administrador || "Sin sesión"}</td>
                  <td>{a.accion}</td>
                  <td><span className={`resultado ${a.resultado}`}>{a.resultado}</span></td>
                  <td>{a.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export default function Administracion() {
  const [sesion, setSesion] = useState(sesionGuardada);
  const [aviso, setAviso] = useState(null);

  function iniciar(nueva) {
    guardarSesion(nueva); setSesion(nueva); setAviso(null);
  }
  function salir() {
    guardarSesion(null); setSesion(null);
  }
  const vencida = useCallback(() => {
    guardarSesion(null); setSesion(null);
    setAviso("La sesión venció o ya no es válida. Inicie sesión de nuevo.");
  }, []);

  return sesion ? <Panel sesion={sesion} onSalir={salir} onVencida={vencida} />
    : <InicioSesion onSesion={iniciar} aviso={aviso} />;
}
