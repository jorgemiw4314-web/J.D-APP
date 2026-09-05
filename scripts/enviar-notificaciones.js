// Revisa los clientes con pago próximo a vencer (o ya vencido) y manda una
// notificación push a los dispositivos registrados en J.D Ventas.
// Replica exactamente la misma lógica de vencimientos que usa la app
// (ver calcularVencimientos / calcularEstadoVencimiento en index.html).

const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const NOMBRES_SERVICIOS = { internet: 'Internet', netflix: 'Netflix', spotify: 'Spotify', otros: 'Otros' };
const LIMITE_DIAS = 5; // mismo límite que usa la app para mostrar el aviso

function claveMes(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function sumarMes(fecha) {
  const dia = fecha.getDate();
  const destino = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 1);
  const diasEnDestino = new Date(destino.getFullYear(), destino.getMonth() + 1, 0).getDate();
  destino.setDate(Math.min(dia, diasEnDestino));
  return destino;
}

// Misma lógica que calcularEstadoVencimiento() en la app: si el cliente tiene
// fecha real del último pago (ultimoPago), vence 1 mes después; si no, usa el
// día fijo de vencimiento (diaPago) sobre el mes actual.
function calcularDiasRestantes(c, hoy) {
  let fechaVenc;
  if (c.ultimoPago) {
    fechaVenc = sumarMes(new Date(c.ultimoPago + 'T00:00:00'));
  } else if (c.diaPago) {
    const diasEnMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
    const dia = Math.min(c.diaPago, diasEnMes);
    fechaVenc = new Date(hoy.getFullYear(), hoy.getMonth(), dia);
  } else {
    return null;
  }
  return Math.round((fechaVenc - hoy) / 86400000);
}

async function main() {
  const snap = await db.collection('jdventas').doc('principal').get();
  if (!snap.exists) {
    console.log('No hay datos guardados todavía en Firestore.');
    return;
  }
  const datos = snap.data();
  const tokens = datos.fcmTokens || [];
  if (tokens.length === 0) {
    console.log('No hay dispositivos registrados para notificaciones (fcmTokens vacío).');
    return;
  }

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const claveReal = claveMes(hoy);
  const pagosReales = (datos.pagosMes && datos.pagosMes[claveReal]) || {};
  const data = datos.data || {};

  const vencimientos = [];
  Object.entries(data).forEach(([sk, s]) => {
    (s.clientes || []).forEach((c) => {
      if (c.tipoPago !== 'mensual' || (!c.diaPago && !c.ultimoPago)) return;
      if (pagosReales[sk + ':' + c.id]) return; // ya pagó este mes
      const diff = calcularDiasRestantes(c, hoy);
      if (diff === null) return;
      if (diff <= LIMITE_DIAS) {
        vencimientos.push({ servicio: sk, cliente: c, diasRestantes: diff });
      }
    });
  });

  if (vencimientos.length === 0) {
    console.log('No hay pagos próximos a vencer hoy. No se manda nada.');
    return;
  }

  vencimientos.sort((a, b) => a.diasRestantes - b.diasRestantes);
  console.log(`Se encontraron ${vencimientos.length} pago(s) próximos a vencer. Enviando notificaciones...`);

  for (const v of vencimientos) {
    const nombreServicio = NOMBRES_SERVICIOS[v.servicio] || v.servicio;
    const texto = v.diasRestantes < 0
      ? `Vencido hace ${Math.abs(v.diasRestantes)} día(s) — ${nombreServicio}`
      : v.diasRestantes === 0
        ? `Vence hoy — ${nombreServicio}`
        : `Vence en ${v.diasRestantes} día(s) — ${nombreServicio}`;

    const mensaje = {
      notification: {
        title: v.cliente.nombre,
        body: texto
      },
      tokens
    };

    try {
      const respuesta = await admin.messaging().sendEachForMulticast(mensaje);
      console.log(`"${v.cliente.nombre}": ${respuesta.successCount} enviado(s), ${respuesta.failureCount} fallido(s)`);
    } catch (e) {
      console.error(`Error enviando notificación para "${v.cliente.nombre}":`, e.message);
    }
  }
}

main().catch((e) => {
  console.error('Error general:', e);
  process.exit(1);
});
