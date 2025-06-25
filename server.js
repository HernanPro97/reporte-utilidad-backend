const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');

// Asegúrate de que tu contraseña esté aquí
const uri = "mongodb+srv://hernanpellicer99:YvgCeNxpL4CJJMAg@cluster0.pftwbfl.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

// --- CAMBIO PARA ESTABILIZAR LA CONEXIÓN ---
// Añadimos opciones para darle más tiempo a la conexión antes de fallar.
const client = new MongoClient(uri, {
    connectTimeoutMS: 30000, // Esperar 30 segundos para conectar
    serverSelectionTimeoutMS: 30000 // Esperar 30 segundos para encontrar un servidor
});
// ------------------------------------------

let db;

async function connectDB() {
    try {
        await client.connect();
        db = client.db('reportesDB'); 
        console.log("¡Conectado exitosamente a la base de datos MongoDB!");
    } catch (error) {
        console.error("Falló la conexión a la base de datos", error);
        process.exit(1); 
    }
}

const app = express();
app.use(cors());
app.use(express.json());
const port = process.env.PORT || 3000;

function calcularResumen(reporteData) {
    let totalIngresos = 0, totalCostoServicio = 0, totalGastosOperativos = 0;
    reporteData.sectionsData.forEach(s => s.subSections.forEach(ss => ss.rows.forEach(r => {
        if (r.category === 'ingresos') totalIngresos += r.value;
        if (r.category === 'costo-servicio') totalCostoServicio += r.value;
        if (r.category === 'gastos-op') totalGastosOperativos += r.value;
    })));
    const utilidadBruta = totalIngresos - totalCostoServicio;
    const utilidadOperativa = utilidadBruta - totalGastosOperativos;
    const utilidadNeta = utilidadOperativa - (reporteData.impuestos || 0);
    return { totalIngresos, utilidadBruta, utilidadOperativa, utilidadNeta };
}

// --- RUTAS DE LA API (sin cambios) ---
app.post('/api/reportes', async (req, res) => {
    try {
        const reporteData = req.body;
        const resumen = calcularResumen(reporteData);
        const documentoAGuardar = { period: reporteData.period, summary: resumen, fullData: reporteData };
        const collection = db.collection('reportesMensuales');
        const filter = { "period.year": reporteData.period.year, "period.month": reporteData.period.month };
        const updateDoc = { $set: documentoAGuardar };
        const options = { upsert: true };
        await collection.updateOne(filter, updateDoc, options);
        res.status(200).json({ status: 'success', message: 'Reporte guardado/actualizado exitosamente.' });
    } catch (error) {
        console.error("Error al guardar/actualizar el reporte:", error);
        res.status(500).json({ status: 'error', message: 'Error interno del servidor.' });
    }
});

app.get('/api/reportes', async (req, res) => {
    try {
        const collection = db.collection('reportesMensuales');
        const reportes = await collection.find({}, { 
            projection: { _id: 1, period: 1, summary: 1 } 
        }).sort({ "period.year": 1, "period.month": 1 }).toArray();
        res.status(200).json({ status: 'success', data: reportes });
    } catch (error) {
        console.error("Error al obtener los reportes:", error);
        res.status(500).json({ status: 'error', message: 'Error interno del servidor.' });
    }
});

app.get('/api/chart-data', async (req, res) => {
    try {
        const collection = db.collection('reportesMensuales');
        const reportes = await collection.find({}).sort({ "period.year": 1, "period.month": 1 }).toArray();
        const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
        const labels = reportes.map(r => `${meses[parseInt(r.period.month)]} ${r.period.year}`);
        const ingresosData = reportes.map(r => r.summary.totalIngresos);
        const utilidadNetaData = reportes.map(r => r.summary.utilidadNeta);
        res.status(200).json({ status: 'success', data: { labels: labels, datasets: [ { label: 'Ingresos Totales', data: ingresosData, borderColor: '#007bff', backgroundColor: 'rgba(0, 123, 255, 0.1)', fill: true, tension: 0.1 }, { label: 'Utilidad Neta', data: utilidadNetaData, borderColor: '#28a745', backgroundColor: 'rgba(40, 167, 69, 0.1)', fill: true, tension: 0.1 } ] } });
    } catch (error) {
        console.error("Error al obtener los datos para el gráfico:", error);
        res.status(500).json({ status: 'error', message: 'Error interno del servidor.' });
    }
});

app.get('/api/reportes/detalle/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ status: 'error', message: 'ID de reporte inválido.' });
        const collection = db.collection('reportesMensuales');
        const reporte = await collection.findOne({ _id: new ObjectId(id) });
        if (reporte) {
            res.status(200).json({ status: 'success', data: reporte.fullData });
        } else {
            res.status(404).json({ status: 'error', message: 'Reporte no encontrado.' });
        }
    } catch (error) {
        console.error("Error al obtener el detalle del reporte:", error);
        res.status(500).json({ status: 'error', message: 'Error interno del servidor.' });
    }
});

app.delete('/api/reportes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ status: 'error', message: 'ID de reporte inválido.' });
        }
        
        const collection = db.collection('reportesMensuales');
        const result = await collection.deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 1) {
            console.log(`Reporte con ID ${id} fue eliminado.`);
            res.status(200).json({ status: 'success', message: 'Reporte eliminado exitosamente.' });
        } else {
            res.status(404).json({ status: 'error', message: 'No se encontró el reporte para eliminar.' });
        }
    } catch (error) {
        console.error("Error al eliminar el reporte:", error);
        res.status(500).json({ status: 'error', message: 'Error interno del servidor.' });
    }
});

app.listen(port, () => {
    console.log(`Servidor escuchando en el puerto ${port}`);
    connectDB();
});
