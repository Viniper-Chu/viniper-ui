[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$ShortcutPath,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$AppUserModelId
)

$ErrorActionPreference = 'Stop'
$resolvedPath = [System.IO.Path]::GetFullPath($ShortcutPath)
if (-not (Test-Path -LiteralPath $resolvedPath -PathType Leaf)) {
    throw "Shortcut does not exist: $resolvedPath"
}

function Get-ShortcutAppUserModelId([string]$Path) {
    $shell = New-Object -ComObject Shell.Application
    $folder = $shell.Namespace((Split-Path -Parent $Path))
    if (-not $folder) { return '' }
    $item = $folder.ParseName((Split-Path -Leaf $Path))
    if (-not $item) { return '' }
    return [string]$item.ExtendedProperty('System.AppUserModel.ID')
}

if ((Get-ShortcutAppUserModelId $resolvedPath) -eq $AppUserModelId) {
    return
}

if (-not ('Viniper.WindowsShell.ShortcutPropertyStore' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace Viniper.WindowsShell
{
    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    public struct PropertyKey
    {
        public Guid FormatId;
        public uint PropertyId;

        public PropertyKey(Guid formatId, uint propertyId)
        {
            FormatId = formatId;
            PropertyId = propertyId;
        }
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct PropVariant : IDisposable
    {
        [FieldOffset(0)] public ushort VariantType;
        [FieldOffset(8)] public IntPtr PointerValue;

        public static PropVariant FromString(string value)
        {
            PropVariant variant = new PropVariant();
            variant.VariantType = 31; // VT_LPWSTR
            variant.PointerValue = Marshal.StringToCoTaskMemUni(value);
            return variant;
        }

        public void Dispose()
        {
            if (PointerValue != IntPtr.Zero)
            {
                Marshal.FreeCoTaskMem(PointerValue);
                PointerValue = IntPtr.Zero;
            }
        }
    }

    [ComImport]
    [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPropertyStore
    {
        [PreserveSig] int GetCount(out uint propertyCount);
        [PreserveSig] int GetAt(uint propertyIndex, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
        [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
        [PreserveSig] int Commit();
    }

    public static class ShortcutPropertyStore
    {
        private const uint GpsReadWrite = 0x00000002;
        private static readonly PropertyKey AppUserModelIdKey = new PropertyKey(
            new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),
            5
        );

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
        private static extern int SHGetPropertyStoreFromParsingName(
            [MarshalAs(UnmanagedType.LPWStr)] string path,
            IntPtr bindContext,
            uint flags,
            ref Guid interfaceId,
            [MarshalAs(UnmanagedType.Interface)] out IPropertyStore propertyStore
        );

        public static void SetAppUserModelId(string shortcutPath, string appUserModelId)
        {
            Guid interfaceId = typeof(IPropertyStore).GUID;
            IPropertyStore store;
            int result = SHGetPropertyStoreFromParsingName(
                shortcutPath,
                IntPtr.Zero,
                GpsReadWrite,
                ref interfaceId,
                out store
            );
            Marshal.ThrowExceptionForHR(result);
            if (store == null)
            {
                throw new InvalidOperationException("Windows did not return a shortcut property store.");
            }

            PropertyKey key = AppUserModelIdKey;
            PropVariant value = PropVariant.FromString(appUserModelId);
            try
            {
                Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref value));
                Marshal.ThrowExceptionForHR(store.Commit());
            }
            finally
            {
                value.Dispose();
                Marshal.ReleaseComObject(store);
            }
        }
    }
}
'@
}

[Viniper.WindowsShell.ShortcutPropertyStore]::SetAppUserModelId($resolvedPath, $AppUserModelId)
$actual = Get-ShortcutAppUserModelId $resolvedPath
if ($actual -ne $AppUserModelId) {
    throw "Shortcut AppUserModelID verification failed for $resolvedPath"
}
