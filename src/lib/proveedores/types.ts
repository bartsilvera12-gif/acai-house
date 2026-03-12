export type EstadoProveedor = "activo" | "inactivo";

export interface Proveedor {
  id: number;
  nombre: string;
  ruc: string;
  telefono: string;
  email: string;
  direccion: string;
  contacto: string;
  estado: EstadoProveedor;
  fecha_creacion: string; // ISO string
}
