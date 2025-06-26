const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');

// Asegúrate de que tu contraseña esté aquí
const uri = "mongodb+srv://hernanpellicer99:YvgCeNxpL4CJJMAg@cluster0.pftwbfl.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

const client = new MongoClient(uri, {
    connectTimeoutMS: 30000,
    serverSelectionTimeoutMS: 30000
});

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
    
    if (reporteData.sectionsData) {
        reporteData.sectionsData.forEach(s => {
            if (s.subSections) {
                s.subSections.forEach(ss => {
                    if (ss.rows) {
                        ss.rows.forEach(r => {
                            if (r.category === 'ingresos') totalIngresos += r.value;
                            if (r.category === 'costo-servicio') totalCostoServicio += r.value;
                            if (r.category === 'gastos-op') totalGastosOperativos += r.value;
                        });
                    }
                });
            }
        });
    }

    const utilidadBruta = totalIngresos - totalCostoServicio;
    const utilidadOperativa = utilidadBruta - totalGastosOperativos;
    const impuestos = reporteData.impuestos || 0;
    const utilidadNeta = utilidadOperativa - impuestos;
    const margenNeto = totalIngresos > 0 ? (utilidadNeta / totalIngresos) * 100 : 0;

    return { totalIngresos, totalCostoServicio, totalGastosOperativos, impuestos, utilidadBruta, utilidadOperativa, utilidadNeta, margenNeto };
}

// --- RUTAS DE LA API ---

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
        res.status(500).json({ status: 'error', message: 'Error interno del servidor.' });
    }
});

app.get('/api/reportes', async (req, res) => {
    try {
        const collection = db.collection('reportesMensuales');
        const reportes = await collection.find({}, { 
            projection: { _id: 1, period: 1, "summary.totalIngresos": 1, "summary.utilidadBruta": 1, "summary.utilidadNeta": 1 } 
        }).sort({ "period.year": 1, "period.month": 1 }).toArray();
        res.status(200).json({ status: 'success', data: reportes });
    } catch (error) {
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
        res.status(200).json({ status: 'success', data: { labels, datasets: [ { label: 'Ingresos Totales', data: ingresosData, borderColor: 'rgb(59, 130, 246)', backgroundColor: 'rgba(59, 130, 246, 0.1)', fill: true, tension: 0.3, pointBackgroundColor: 'rgb(59, 130, 246)' }, { label: 'Utilidad Neta', data: utilidadNetaData, borderColor: 'rgb(34, 197, 94)', backgroundColor: 'rgba(34, 197, 94, 0.1)', fill: true, tension: 0.3, pointBackgroundColor: 'rgb(34, 197, 94)' } ] } });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Error interno del servidor.' });
    }
});

app.get('/api/reportes/detalle/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ status: 'error', message: 'ID inválido.' });
        const collection = db.collection('reportesMensuales');
        const reporte = await collection.findOne({ _id: new ObjectId(id) });
        res.status(reporte ? 200 : 404).json(reporte ? { status: 'success', data: reporte.fullData } : { status: 'error', message: 'Reporte no encontrado.' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Error interno del servidor.' });
    }
});

app.delete('/api/reportes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ status: 'error', message: 'ID inválido.' });
        const collection = db.collection('reportesMensuales');
        const result = await collection.deleteOne({ _id: new ObjectId(id) });
        res.status(result.deletedCount === 1 ? 200 : 404).json(result.deletedCount === 1 ? { status: 'success', message: 'Reporte eliminado.' } : { status: 'error', message: 'No se encontró el reporte.' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Error interno del servidor.' });
    }
});

app.get('/api/kpi-summary/:year/:month', async(req, res) => {
    try {
        const { year, month } = req.params;
        const collection = db.collection('reportesMensuales');
        
        const report = await collection.findOne({ 
            "period.year": year, 
            "period.month": month 
        });

        if (!report) {
            return res.status(404).json({ status: 'error', message: 'No se encontró reporte para este período.' });
        }
        res.status(200).json({ status: 'success', data: report.summary });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Error interno del servidor.' });
    }
});

app.listen(port, () => {
    console.log(`Servidor escuchando en el puerto ${port}`);
    connectDB();
});
