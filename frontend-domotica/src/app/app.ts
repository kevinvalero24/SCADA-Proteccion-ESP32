import {
  Component,
  OnInit,
  AfterViewInit,
  ChangeDetectorRef,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
// ---> 1. AGREGAMOS EL IMPORT DE FormsModule PARA [(ngModel)] <---
import { FormsModule } from '@angular/forms'; 

import { TelemetriaService } from './services/telemetria';
import { NodoService } from './services/nodo';
import { AlertaService } from './services/alerta'; 
import { Chart, registerables } from 'chart.js';
import { io } from 'socket.io-client'; 
import { AuthService } from './services/auth';
import { LoginComponent } from './components/login/login';

Chart.register(...registerables);

@Component({
  selector: 'app-root',
  standalone: true,
  // ---> 2. INCLUIMOS FormsModule EN LOS IMPORTS <---
  imports: [RouterOutlet, CommonModule, LoginComponent, FormsModule], 
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, AfterViewInit {
  datoActual: any = {};
  graficaCarga: any;
  esFormato24h: boolean = true;
  // Control de resolución visual para el reporte de energía
  cantidadDecimales: number = 2;
  historialCompleto: any[] = [];

  alarmaActiva: boolean = false;
  mensajeAlarma: string = 'Sistema Energizado y en Línea';
  conexionPerdida: boolean = false;
  menuReporteAbierto: boolean = false;

  // Variables para la gestión de tableros
  listaNodos: any[] = [];
  mostrarPanelConfig: boolean = false;

  // Variables para el log de eventos (SOE)
  historialAlertas: any[] = [];
  mostrarPanelAlertas: boolean = false;

  // ---> MODIFICADO: Estructura preparada para los 3 periodos de facturación <---
  metricasEnergia: any = { 
    hoy: { energia_kwh: 0, costo_cop: 0 },
    semana: { energia_kwh: 0, costo_cop: 0 },
    mes: { energia_kwh: 0, costo_cop: 0 }
  };

  // =========================================================
  // ---> REFERENCIAS VISUALES (CANVAS) <---
  // =========================================================
  @ViewChild('graficaConsumo') canvasLienzo!: ElementRef;
  
  // Nuevos Canvas para los Velocímetros (Gauges)
  @ViewChild('graficaVoltaje') canvasVoltaje!: ElementRef;
  @ViewChild('graficaCorriente') canvasCorriente!: ElementRef;
  @ViewChild('graficaPotencia') canvasPotencia!: ElementRef;

  // Variables para controlar los objetos Chart de las agujas
  gaugeVoltaje: any;
  gaugeCorriente: any;
  gaugePotencia: any;

  toggleMenuReporte() {
    this.menuReporteAbierto = !this.menuReporteAbierto;
  }
  
  // =========================================================
  // ---> CEREBRO HMI BIDIRECCIONAL (WEBSOCKETS) <---
  // =========================================================
  socket: any;
  estadoMando: any = {
    modo: 'manual',
    forzar_rele: true,
    hora_inicio: '',
    hora_fin: '',
  };

  // ---> INYECCIÓN DE DEPENDENCIAS <---
  constructor(
    private telemetriaService: TelemetriaService,
    private cdr: ChangeDetectorRef,
    public authService: AuthService,
    private nodoService: NodoService,
    private alertaService: AlertaService 
  ) {}

  cerrarSesionTerminal() {
    this.authService.logout();
    window.location.reload();
  }

  descargarReporteMensual(tipo: string) {
    this.menuReporteAbierto = false; 
    const url = this.telemetriaService.exportarHistorialCSV(tipo);
    window.open(url, '_blank');
  }

  ngOnInit() {
    this.conectarRadioSCADA(); 
    
    // Disparo inicial de ambos motores al abrir la pantalla
    this.leerTarjetasEnVivo();
    this.leerGraficaHistorica();
    
    // RELOJ RÁPIDO: Lee la RAM cada 5 segundos para tarjetas y alarmas
    setInterval(() => {
      this.leerTarjetasEnVivo();
    }, 5000);

    // RELOJ LENTO: Lee MongoDB cada 60 segundos para la gráfica y facturación
    setInterval(() => {
      this.leerGraficaHistorica();
    }, 60000);
  }

  conectarRadioSCADA() {
    this.socket = io('http://localhost:3000');
    this.socket.on('estado_mando', (estadoActualizado: any) => {
      this.estadoMando = estadoActualizado;
      this.cdr.detectChanges();
    });
  }

  cambiarModo(nuevoModo: string) {
    this.estadoMando.modo = nuevoModo;
    this.socket.emit('comando_operador', this.estadoMando);
  }

  enviarComandoManual(estado: boolean) {
    this.estadoMando.forzar_rele = estado;
    this.socket.emit('comando_operador', this.estadoMando);
  }

  actualizarHorario(tipo: string, event: any) {
    if (tipo === 'inicio') this.estadoMando.hora_inicio = event.target.value;
    if (tipo === 'fin') this.estadoMando.hora_fin = event.target.value;
    this.socket.emit('comando_operador', this.estadoMando);
  }
  
  // =========================================================
  // ---> MÓDULO DE GESTIÓN DE NODOS Y CIRCUITOS <---
  // =========================================================
  
  abrirPanelConfiguracion() {
    this.mostrarPanelConfig = !this.mostrarPanelConfig;
    if (this.mostrarPanelConfig) {
      this.mostrarPanelAlertas = false; 
      this.nodoService.obtenerNodos().subscribe({
        next: (res) => this.listaNodos = res,
        error: (err) => console.error('Error al cargar la topología', err)
      });
    }
  }

  guardarNuevoUmbral(idNodo: string, idCircuito: string, valorInput: string) {
    const watts = Number(valorInput);
    this.nodoService.actualizarUmbral(idNodo, idCircuito, watts).subscribe({
      next: (res) => {
        alert(`¡Configuración exitosa! Límite actualizado a ${watts}W.`);
        this.nodoService.obtenerNodos().subscribe(data => this.listaNodos = data);
      },
      error: (err) => {
        console.error(err);
        alert('Falla al reconfigurar el umbral.');
      }
    });
  }

  // =========================================================
  // ---> MÓDULO DE HISTORIAL DE ALARMAS (SOE) <---
  // =========================================================
  
  abrirPanelAlertas() {
    this.mostrarPanelAlertas = !this.mostrarPanelAlertas;
    if (this.mostrarPanelAlertas) {
      this.mostrarPanelConfig = false; 
      this.alertaService.obtenerHistorial().subscribe({
        next: (res) => this.historialAlertas = res,
        error: (err) => console.error('Error al cargar el Sequence of Events', err)
      });
    }
  }

  // =========================================================
  // ---> GESTIÓN VISUAL Y GRÁFICAS <---
  // =========================================================

  ngAfterViewInit() {
    this.inicializarGrafica(); // Curva asíncrona histórica
    this.inicializarVelocimetros(); // Gauges analógicos en tiempo real
  }

  inicializarGrafica() {
    if (this.canvasLienzo) {
      this.graficaCarga = new Chart(this.canvasLienzo.nativeElement, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Consumo de Potencia (W)',
              data: [],
              borderColor: '#ffc107',
              backgroundColor: 'rgba(255, 193, 7, 0.1)',
              borderWidth: 2,
              fill: true,
              tension: 0.4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          scales: {
            x: {
              display: true,
              grid: { color: 'rgba(255, 255, 255, 0.05)' },
              ticks: { color: '#8892b0', maxTicksLimit: 8 },
            },
            y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#8892b0' } },
          },
        },
      });
    }
  }

  inicializarVelocimetros() {
    const opcionesComunes = (color: string) => ({
      responsive: true,
      maintainAspectRatio: false,
      circumference: 180, 
      rotation: 270,      
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      cutout: '75%'       
    });

    if (this.canvasVoltaje) {
      this.gaugeVoltaje = new Chart(this.canvasVoltaje.nativeElement, {
        type: 'doughnut',
        data: { datasets: [{ data: [0, 150], backgroundColor: ['#ffc107', 'rgba(255,255,255,0.05)'], borderWidth: 0 }] },
        options: opcionesComunes('#ffc107')
      });
    }

    if (this.canvasCorriente) {
      this.gaugeCorriente = new Chart(this.canvasCorriente.nativeElement, {
        type: 'doughnut',
        data: { datasets: [{ data: [0, 5], backgroundColor: ['#0dcaf0', 'rgba(255,255,255,0.05)'], borderWidth: 0 }] },
        options: opcionesComunes('#0dcaf0')
      });
    }

    if (this.canvasPotencia) {
      this.gaugePotencia = new Chart(this.canvasPotencia.nativeElement, {
        type: 'doughnut',
        data: { datasets: [{ data: [0, 1200], backgroundColor: ['#198754', 'rgba(255,255,255,0.05)'], borderWidth: 0 }] },
        options: opcionesComunes('#198754')
      });
    }
  }

  actualizarArcoGauge(chart: any, valor: number, maximo: number) {
    if (chart) {
      const valorLimpio = valor > maximo ? maximo : (valor < 0 ? 0 : valor);
      chart.data.datasets[0].data = [valorLimpio, maximo - valorLimpio];
      chart.update();
    }
  }

  toggleFormatoHora(event: any) {
    this.esFormato24h = event.target.checked;
    this.leerGraficaHistorica(); 
  }

  // =========================================================
  // ---> MOTOR RÁPIDO: TARJETAS VISUALES Y ALARMAS (5 SEG) <---
  // =========================================================
  leerTarjetasEnVivo() {
    this.telemetriaService.obtenerDatosEnVivo().subscribe({
      next: (datoRapido: any) => {
        if (datoRapido) {
          this.datoActual = datoRapido;

          this.actualizarArcoGauge(this.gaugeVoltaje, Number(this.datoActual.voltage || 0), 150);
          this.actualizarArcoGauge(this.gaugeCorriente, Number(this.datoActual.current || 0), 5); 
          this.actualizarArcoGauge(this.gaugePotencia, Number(this.datoActual.power || 0), 1200); 

          if (this.datoActual.timestamp) {
            const tiempoDelDato = new Date(this.datoActual.timestamp).getTime();
            const tiempoActual = new Date().getTime();
            const diferenciaSegundos = (tiempoActual - tiempoDelDato) / 1000;

            if (diferenciaSegundos > 20) {
              this.conexionPerdida = true;
              this.alarmaActiva = false;
              this.mensajeAlarma = '¡PÉRDIDA DE SEÑAL DE TELEMETRÍA!';
            } else {
              this.conexionPerdida = false;

              if (this.datoActual.sensor_error === true || this.datoActual.sensor_error === 'true') {
                this.alarmaActiva = true;
                this.mensajeAlarma = '¡FALLA CRÍTICA: PÉRDIDA DE SEÑAL DEL SENSOR PZEM!';
              } else if (this.datoActual.alarm_state === true || this.datoActual.alarm_state === 'true') {
                this.alarmaActiva = true;
                this.mensajeAlarma = '¡FALLA: PROTECCIÓN DISPARADA DESDE EL HARDWARE!';
              } else {
                this.alarmaActiva = false;
                this.mensajeAlarma = 'Sistema Energizado y en Línea';
              }
            }
          }
          this.cdr.detectChanges();
        }
      },
      error: (err: any) => console.error('Falla al leer RAM:', err)
    });
  }

  // =========================================================
  // ---> MOTOR LENTO: GRÁFICA Y COSTOS (60 SEG) <---
  // =========================================================
  leerGraficaHistorica() {
    this.telemetriaService.obtenerDatosReales().subscribe({
      next: (datos: any) => {
        if (datos && datos.length > 0) {
          const datosOrdenados = datos.sort((a: any, b: any) => (a._id > b._id ? 1 : -1));
          this.historialCompleto = datosOrdenados;

          if (this.graficaCarga) {
            const historialReciente = datosOrdenados.slice(-20);
            this.graficaCarga.data.labels = historialReciente.map((d: any) => {
              if (d.timestamp) {
                return new Date(d.timestamp).toLocaleTimeString('es-CO', {
                  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: !this.esFormato24h,
                });
              }
              return '';
            });
            this.graficaCarga.data.datasets[0].data = historialReciente.map((d: any) => d.power);

            if (this.conexionPerdida) {
              this.graficaCarga.data.datasets[0].borderColor = '#6c757d';
              this.graficaCarga.data.datasets[0].backgroundColor = 'rgba(108, 117, 125, 0.1)';
            } else {
              this.graficaCarga.data.datasets[0].borderColor = this.alarmaActiva ? '#dc3545' : '#ffc107';
              this.graficaCarga.data.datasets[0].backgroundColor = this.alarmaActiva ? 'rgba(220, 53, 69, 0.1)' : 'rgba(255, 193, 7, 0.1)';
            }
            this.graficaCarga.update();
          }
          this.cdr.detectChanges();
        }
      },
      error: (error: any) => console.error('Falla en base de datos:', error),
    });

    this.telemetriaService.obtenerMetricas().subscribe({
      next: (res: any) => {
        this.metricasEnergia = res;
        this.cdr.detectChanges();
      },
      error: (err: any) => console.error('Error al cargar métricas de eficiencia', err)
    });
  }
}