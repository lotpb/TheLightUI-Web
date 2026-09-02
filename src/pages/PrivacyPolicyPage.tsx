import { usePageTitle } from '../hooks/usePageTitle'

const CONTACT_EMAIL = 'eunitedws@icloud.com'
const LAST_UPDATED   = 'August 29, 2026'

export default function PrivacyPolicyPage() {
    usePageTitle('Privacy Policy')

    return (
        <div className="min-h-screen bg-gray-950 text-gray-300">
            <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">
                <div>
                    <h1 className="text-2xl font-bold text-white">Privacy Policy</h1>
                    <p className="text-sm text-gray-500 mt-1">Last updated {LAST_UPDATED}</p>
                </div>

                <p>
                    TheLight CRM ("TheLight", "we", "us") provides field service and customer
                    management software to sales and service businesses. This policy explains what
                    information we collect through the app, including data received from Facebook
                    Lead Ads, and how it is used.
                </p>

                <section className="space-y-2">
                    <h2 className="text-lg font-semibold text-white">Information we collect</h2>
                    <p>
                        When a business connects their Facebook Page to TheLight, we receive the
                        information submitted through that Page's Lead Ad forms — typically name,
                        email address, phone number, and any custom questions the business configured
                        in Meta Ads Manager. We also store the Page's name and ID, and an access token
                        used solely to retrieve that Page's leads and manage its webhook subscription.
                    </p>
                    <p>
                        We also collect account information for people who use the CRM directly
                        (name, email, role) and the customer/lead records they create or import,
                        which may include contact details, service history, and location data tied
                        to appointments.
                    </p>
                </section>

                <section className="space-y-2">
                    <h2 className="text-lg font-semibold text-white">How we use this information</h2>
                    <p>
                        Lead data received from Facebook is used only to create a record in the
                        connected business's CRM account so their team can follow up with that lead.
                        We do not sell lead or customer data, and we do not use it for advertising or
                        share it with any third party outside of the services (such as Firebase)
                        that host the application and its data.
                    </p>
                </section>

                <section className="space-y-2">
                    <h2 className="text-lg font-semibold text-white">Data storage &amp; retention</h2>
                    <p>
                        Data is stored in Google Firebase (Firestore) with access restricted to the
                        business's own team members. Data is retained for as long as the business's
                        account is active, or until the business deletes the record.
                    </p>
                </section>

                <section className="space-y-2">
                    <h2 className="text-lg font-semibold text-white">Facebook Page disconnection</h2>
                    <p>
                        A business admin can disconnect their Facebook Page from TheLight at any time
                        from the Facebook Leads settings page. Disconnecting revokes our access token
                        and stops any further leads from being imported; previously imported leads
                        remain in the business's own CRM account under their control.
                    </p>
                </section>

                <section className="space-y-2">
                    <h2 className="text-lg font-semibold text-white">Contact us</h2>
                    <p>
                        Questions about this policy or your data can be sent to{' '}
                        <a href={`mailto:${CONTACT_EMAIL}`} className="text-indigo-400 hover:text-indigo-300">
                            {CONTACT_EMAIL}
                        </a>.
                    </p>
                </section>
            </div>
        </div>
    )
}
