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
import { TelemetriaService } from './services/telemetria';
import { NodoService } from './services/nodo';
import { AlertaService } from './services/alerta'; // <-- NUEVO: Servicio del historial (SOE)
import { Chart, registerables } from 'chart.js';
import { io } from 'socket.io-client'; 
import { AuthService } from './services/auth';
import { LoginComponent } from './components/login/login';

Chart.register(...registerables);

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule, LoginComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, AfterViewInit {
  datoActual: any = {};
  graficaCarga: any;
  esFormato24h: boolean = true;
  historialCompleto: any[] = [];

  alarmaActiva: boolean = false;
  mensajeAlarma: string = 'Sistema Energizado y en Línea';
  conexionPerdida: boolean = false;
  menuReporteAbierto: boolean = false;

  // Variables para la gestión de tableros
  listaNodos: any[] = [];
  mostrarPanelConfig: boolean = false;

  // NUEVO: Variables para el log de eventos (SOE)
  historialAlertas: any[] = [];
  mostrarPanelAlertas: boolean = false;

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

  @ViewChild('graficaConsumo') canvasLienzo!: ElementRef;

  // ---> INYECCIÓN DE DEPENDENCIAS <---
  constructor(
    private telemetriaService: TelemetriaService,
    private cdr: ChangeDetectorRef,
    public authService: AuthService,
    private nodoService: NodoService,
    private alertaService: AlertaService // <-- Inyectamos el servicio de fallas
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
    this.leerTablero();
    setInterval(() => {
      this.leerTablero();
    }, 3000);
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
      this.mostrarPanelAlertas = false; // Cerramos el otro panel para no saturar la vista
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
  // ---> NUEVO: MÓDULO DE HISTORIAL DE ALARMAS (SOE) <---
  // =========================================================
  
  abrirPanelAlertas() {
    this.mostrarPanelAlertas = !this.mostrarPanelAlertas;
    if (this.mostrarPanelAlertas) {
      this.mostrarPanelConfig = false; // Cerramos el panel de configuración
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
    this.inicializarGrafica();
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

  toggleFormatoHora(event: any) {
    this.esFormato24h = event.target.checked;
    this.leerTablero();
  }

  leerTablero() {
    this.telemetriaService.obtenerDatosReales().subscribe({
      next: (datos: any) => {
        if (datos && datos.length > 0) {
          const datosOrdenados = datos.sort((a: any, b: any) => (a._id > b._id ? 1 : -1));
          this.historialCompleto = datosOrdenados;
          this.datoActual = datosOrdenados[datosOrdenados.length - 1];

          if (this.datoActual.timestamp) {
            const tiempoDelDato = new Date(this.datoActual.timestamp).getTime();
            const tiempoActual = new Date().getTime();
            const diferenciaSegundos = (tiempoActual - tiempoDelDato) / 1000;

            if (diferenciaSegundos > 15) {
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
  }
}