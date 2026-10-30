// Configuration shared by all devices.
//
// SharePoint (js/sharepoint.js): all werkbonnen, photos and lists are kept in one SharePoint folder,
// so every technician sees the same data. Each technician signs in with their BOSS Microsoft 365
// account. tenantId and clientId come from the app registration in Microsoft Entra ID (IT, once:
// see README "SharePoint koppelen"). As long as they are empty, the app keeps everything on the device.
// The ids below are no secrets: without a BOSS sign-in with access to the folder they give nothing.
//
// Central database (Supabase): switched OFF (centraal: false), replaced by SharePoint.
window.WERKBON_CONFIG = {
  sharepoint: {
    tenantId: '',
    clientId: '',
    // Sites/Diensten › Gedeelde documenten › General › MyMx › Werkbonnen Boss
    driveId: 'b!8XK_-GjYyUCGS9qhBnQtWOS3tWanIdFGtD7Q570FjATzdA3WxbxjT5h4e3U1IOpt',
    mapId: '01W7AF67PM2ODCF2VLWRC235HCCNYMWKMQ',
    link: 'https://biint.sharepoint.com/sites/Diensten/Gedeelde%20documenten/General/MyMx/Werkbonnen%20Boss',
  },
  centraal: false,
  supabaseUrl: '',
  supabaseKey: '',
};
